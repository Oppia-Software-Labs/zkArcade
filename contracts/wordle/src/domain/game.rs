use soroban_sdk::{contracttype, Address, BytesN, Vec};

use super::errors::DomainError;
use super::feedback::Feedback;
use super::word::{Guess, WordCommitment, ALPHABET_SIZE, WORD_LENGTH};

/// Maximum number of guesses allowed
pub const MAX_GUESSES: u32 = 6;

/// Game lifecycle phases
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GamePhase {
    /// Waiting for word setter to commit their word
    WaitingForWord,
    /// Game in progress, players taking turns
    InProgress,
    /// Game has ended
    Ended,
}

/// Game rules (immutable configuration)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameRules {
    pub word_length: u32,
    pub max_guesses: u32,
    pub alphabet_size: u32,
}

impl Default for GameRules {
    fn default() -> Self {
        Self {
            word_length: WORD_LENGTH,
            max_guesses: MAX_GUESSES,
            alphabet_size: ALPHABET_SIZE,
        }
    }
}

/// Game aggregate - core domain entity
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    // Players
    pub word_setter: Address,
    pub guesser: Address,
    pub word_setter_points: i128,
    pub guesser_points: i128,

    // Game state
    pub phase: GamePhase,
    pub word_commitment: Option<BytesN<32>>,
    pub guess_count: u32,
    pub pending_guess: Option<BytesN<5>>,
    pub winner: Option<Address>,

    // History
    pub guesses: Vec<BytesN<5>>,
    pub feedbacks: Vec<Vec<u32>>,
}

impl Game {
    /// Creates a new game in WaitingForWord phase
    pub fn new(
        word_setter: Address,
        guesser: Address,
        word_setter_points: i128,
        guesser_points: i128,
        env: &soroban_sdk::Env,
    ) -> Result<Self, DomainError> {
        if word_setter == guesser {
            return Err(DomainError::SelfPlayNotAllowed);
        }

        Ok(Self {
            word_setter,
            guesser,
            word_setter_points,
            guesser_points,
            phase: GamePhase::WaitingForWord,
            word_commitment: None,
            guess_count: 0,
            pending_guess: None,
            winner: None,
            guesses: Vec::new(env),
            feedbacks: Vec::new(env),
        })
    }

    /// Commits the secret word (word setter only)
    pub fn commit_word(
        &mut self,
        player: &Address,
        commitment: WordCommitment,
    ) -> Result<(), DomainError> {
        self.ensure_not_ended()?;
        self.ensure_phase(GamePhase::WaitingForWord)?;
        self.ensure_is_word_setter(player)?;

        if self.word_commitment.is_some() {
            return Err(DomainError::WordAlreadyCommitted);
        }

        self.word_commitment = Some(commitment);
        self.phase = GamePhase::InProgress;
        Ok(())
    }

    /// Submits a guess (guesser only)
    pub fn submit_guess(&mut self, player: &Address, guess: &Guess) -> Result<(), DomainError> {
        self.ensure_not_ended()?;
        self.ensure_phase(GamePhase::InProgress)?;
        self.ensure_is_guesser(player)?;

        if self.pending_guess.is_some() {
            return Err(DomainError::PendingGuessExists);
        }

        if self.guess_count >= MAX_GUESSES {
            return Err(DomainError::MaxGuessesReached);
        }

        self.pending_guess = Some(guess.letters().clone());
        Ok(())
    }

    /// Resolves a pending guess with verified feedback
    pub fn resolve_guess(
        &mut self,
        player: &Address,
        feedback: &Feedback,
        is_correct: bool,
    ) -> Result<GameOutcome, DomainError> {
        self.ensure_not_ended()?;
        self.ensure_phase(GamePhase::InProgress)?;
        self.ensure_is_word_setter(player)?;

        let guess_letters = self
            .pending_guess
            .clone()
            .ok_or(DomainError::NoPendingGuess)?;

        // Validate feedback matches is_correct flag
        feedback.validate_correctness(is_correct)?;

        // Record guess and feedback
        self.guesses.push_back(guess_letters);
        self.feedbacks
            .push_back(feedback.to_vec(&soroban_sdk::Env::default()));
        self.guess_count += 1;
        self.pending_guess = None;

        // Determine outcome
        if is_correct {
            self.phase = GamePhase::Ended;
            self.winner = Some(self.guesser.clone());
            Ok(GameOutcome::GuesserWins)
        } else if self.guess_count >= MAX_GUESSES {
            self.phase = GamePhase::Ended;
            self.winner = Some(self.word_setter.clone());
            Ok(GameOutcome::WordSetterWins)
        } else {
            Ok(GameOutcome::Continue)
        }
    }

    /// Records feedback in history (called after resolve with correct env)
    pub fn record_feedback(&mut self, feedback_vec: Vec<u32>) {
        // Replace the last feedback entry with the properly constructed one
        if self.feedbacks.len() > 0 {
            // Remove last (placeholder) and add real one
            let len = self.feedbacks.len();
            let mut new_feedbacks = Vec::new(&soroban_sdk::Env::default());
            for i in 0..(len - 1) {
                new_feedbacks.push_back(self.feedbacks.get(i).unwrap());
            }
            new_feedbacks.push_back(feedback_vec);
            self.feedbacks = new_feedbacks;
        }
    }

    // Validation helpers

    fn ensure_not_ended(&self) -> Result<(), DomainError> {
        if self.phase == GamePhase::Ended {
            return Err(DomainError::GameAlreadyEnded);
        }
        Ok(())
    }

    fn ensure_phase(&self, expected: GamePhase) -> Result<(), DomainError> {
        if self.phase != expected {
            return Err(DomainError::InvalidPhase);
        }
        Ok(())
    }

    fn ensure_is_word_setter(&self, player: &Address) -> Result<(), DomainError> {
        if *player != self.word_setter {
            return Err(DomainError::NotWordSetter);
        }
        Ok(())
    }

    fn ensure_is_guesser(&self, player: &Address) -> Result<(), DomainError> {
        if *player != self.guesser {
            return Err(DomainError::NotGuesser);
        }
        Ok(())
    }

    /// Gets the word commitment (if set)
    pub fn get_word_commitment(&self) -> Result<WordCommitment, DomainError> {
        self.word_commitment
            .clone()
            .ok_or(DomainError::WordNotCommitted)
    }

    /// Gets the pending guess (if any)
    pub fn get_pending_guess(&self) -> Option<BytesN<5>> {
        self.pending_guess.clone()
    }

    /// Checks if guesser won
    pub fn guesser_won(&self) -> bool {
        self.winner.as_ref() == Some(&self.guesser)
    }
}

/// Outcome of resolving a guess
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GameOutcome {
    /// Game continues, more guesses available
    Continue,
    /// Guesser found the word
    GuesserWins,
    /// Word setter wins (max guesses reached)
    WordSetterWins,
}

impl GameOutcome {
    pub fn is_game_over(&self) -> bool {
        matches!(self, GameOutcome::GuesserWins | GameOutcome::WordSetterWins)
    }
}
