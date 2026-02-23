use soroban_sdk::{vec, Address, Bytes, BytesN, Env, IntoVal, Vec};

use crate::domain::{DomainError, Feedback, Game, GameOutcome, Guess};
use crate::infrastructure::{GameHubGateway, GameRepository, VerifierGateway};

use super::dto::GuessResult;

/// Command: Start a new game
pub struct StartGameCommand;

impl StartGameCommand {
    pub fn execute(
        env: &Env,
        session_id: u32,
        word_setter: Address,
        guesser: Address,
        word_setter_points: i128,
        guesser_points: i128,
    ) -> Result<(), DomainError> {
        // Validate self-play not allowed
        if word_setter == guesser {
            return Err(DomainError::SelfPlayNotAllowed);
        }

        // Check game doesn't already exist
        if GameRepository::exists(env, session_id) {
            return Err(DomainError::GameAlreadyExists);
        }

        // Require auth from both players
        word_setter.require_auth_for_args(vec![
            env,
            session_id.into_val(env),
            word_setter_points.into_val(env),
        ]);
        guesser.require_auth_for_args(vec![
            env,
            session_id.into_val(env),
            guesser_points.into_val(env),
        ]);

        // Notify Game Hub first (required ordering)
        GameHubGateway::notify_game_started(
            env,
            session_id,
            &word_setter,
            &guesser,
            word_setter_points,
            guesser_points,
        );

        // Create and save game
        let game = Game::new(
            word_setter,
            guesser,
            word_setter_points,
            guesser_points,
            env,
        )?;

        GameRepository::save(env, session_id, &game);
        Ok(())
    }
}

/// Command: Commit secret word
pub struct CommitWordCommand;

impl CommitWordCommand {
    pub fn execute(
        env: &Env,
        session_id: u32,
        player: Address,
        word_commitment: BytesN<32>,
    ) -> Result<(), DomainError> {
        player.require_auth();

        let mut game = GameRepository::load(env, session_id)?;
        game.commit_word(&player, word_commitment)?;
        GameRepository::save(env, session_id, &game);

        Ok(())
    }
}

/// Command: Submit a guess
pub struct GuessCommand;

impl GuessCommand {
    pub fn execute(
        env: &Env,
        session_id: u32,
        guesser: Address,
        guess_letters: BytesN<5>,
    ) -> Result<(), DomainError> {
        guesser.require_auth();

        let guess = Guess::new(guess_letters)?;
        let mut game = GameRepository::load(env, session_id)?;
        game.submit_guess(&guesser, &guess)?;
        GameRepository::save(env, session_id, &game);

        Ok(())
    }
}

/// Command: Resolve a guess with ZK proof
pub struct ResolveGuessCommand;

impl ResolveGuessCommand {
    pub fn execute(
        env: &Env,
        session_id: u32,
        word_setter: Address,
        feedback: Vec<u32>,
        is_correct: bool,
        proof_payload: Bytes,
        public_inputs_hash: BytesN<32>,
    ) -> Result<GuessResult, DomainError> {
        let mut game = GameRepository::load(env, session_id)?;

        // Validate feedback format
        let _ = Feedback::from_vec(&feedback)?;

        // Get required data for verification
        let word_commitment = game.get_word_commitment()?;
        let guess_letters = game
            .get_pending_guess()
            .ok_or(DomainError::NoPendingGuess)?;

        // Verify public inputs hash
        let expected_hash = Self::build_public_inputs_hash(
            env,
            session_id,
            &word_setter,
            &game.guesser,
            &guess_letters,
            &feedback,
            is_correct,
            &word_commitment,
        );

        if expected_hash != public_inputs_hash {
            return Err(DomainError::InvalidPublicInputsHash);
        }

        // Verify ZK proof
        if !VerifierGateway::verify_proof(env, &word_commitment, &public_inputs_hash, &proof_payload)
        {
            return Err(DomainError::InvalidProof);
        }

        // Manually update game state (avoiding Env::default() in domain)
        game.guesses.push_back(guess_letters);
        game.feedbacks.push_back(feedback.clone());
        game.guess_count += 1;
        game.pending_guess = None;

        let outcome = if is_correct {
            game.phase = crate::domain::GamePhase::Ended;
            game.winner = Some(game.guesser.clone());
            GameOutcome::GuesserWins
        } else if game.guess_count >= crate::domain::game::MAX_GUESSES {
            game.phase = crate::domain::GamePhase::Ended;
            game.winner = Some(game.word_setter.clone());
            GameOutcome::WordSetterWins
        } else {
            GameOutcome::Continue
        };

        // Notify Game Hub if game ended
        if outcome.is_game_over() {
            let word_setter_won = !game.guesser_won();
            GameHubGateway::notify_game_ended(env, session_id, word_setter_won);
        }

        GameRepository::save(env, session_id, &game);

        Ok(GuessResult {
            guess_number: game.guess_count,
            feedback,
            is_correct,
            winner: game.winner.clone(),
            game_ended: outcome.is_game_over(),
        })
    }

    /// Builds the public inputs hash for verification
    pub fn build_public_inputs_hash(
        env: &Env,
        session_id: u32,
        word_setter: &Address,
        guesser: &Address,
        guess_letters: &BytesN<5>,
        feedback: &Vec<u32>,
        is_correct: bool,
        word_commitment: &BytesN<32>,
    ) -> BytesN<32> {
        let mut fixed = [0u8; 15];
        fixed[0..4].copy_from_slice(&session_id.to_be_bytes());

        let guess_arr = guess_letters.to_array();
        fixed[4..9].copy_from_slice(&guess_arr);

        for i in 0..5 {
            fixed[9 + i] = feedback.get(i as u32).unwrap_or(0) as u8;
        }

        fixed[14] = if is_correct { 1 } else { 0 };

        let mut payload = Bytes::from_array(env, &fixed);
        payload.append(&Bytes::from_array(env, &word_commitment.to_array()));
        payload.append(&word_setter.to_string().to_bytes());
        payload.append(&guesser.to_string().to_bytes());

        env.crypto().keccak256(&payload).into()
    }
}
