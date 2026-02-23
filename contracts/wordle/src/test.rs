#![cfg(test)]

use crate::{Error, GamePhase, WordleContract, WordleContractClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, Vec};

// Feedback constants
const ABSENT: u32 = 0;
const PRESENT: u32 = 1;
const CORRECT: u32 = 2;

#[contracttype]
#[derive(Clone)]
enum HubDataKey {
    Started(u32),
    Ended(u32),
}

#[contract]
pub struct MockGameHub;

#[contractimpl]
impl MockGameHub {
    pub fn start_game(
        env: Env,
        _game_id: Address,
        session_id: u32,
        _player1: Address,
        _player2: Address,
        _player1_points: i128,
        _player2_points: i128,
    ) {
        env.storage()
            .persistent()
            .set(&HubDataKey::Started(session_id), &true);
    }

    pub fn end_game(env: Env, session_id: u32, _player1_won: bool) {
        env.storage()
            .persistent()
            .set(&HubDataKey::Ended(session_id), &true);
    }

    pub fn was_started(env: Env, session_id: u32) -> bool {
        env.storage()
            .persistent()
            .get(&HubDataKey::Started(session_id))
            .unwrap_or(false)
    }

    pub fn was_ended(env: Env, session_id: u32) -> bool {
        env.storage()
            .persistent()
            .get(&HubDataKey::Ended(session_id))
            .unwrap_or(false)
    }
}

#[contract]
pub struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn verify(
        _env: Env,
        _word_commitment: BytesN<32>,
        _public_inputs_hash: BytesN<32>,
        proof_payload: Bytes,
    ) -> bool {
        if proof_payload.len() == 0 {
            return false;
        }
        // Convention for tests: first byte 1 => valid proof
        proof_payload.get(0).unwrap() == 1
    }
}

fn setup_test() -> (
    Env,
    WordleContractClient<'static>,
    MockGameHubClient<'static>,
    Address,
    Address,
    BytesN<32>,
) {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1_441_065_600,
        protocol_version: 25,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: u32::MAX / 2,
        min_persistent_entry_ttl: u32::MAX / 2,
        max_entry_ttl: u32::MAX / 2,
    });

    let hub_addr = env.register(MockGameHub, ());
    let verifier_addr = env.register(MockVerifier, ());
    let hub = MockGameHubClient::new(&env, &hub_addr);

    let admin = Address::generate(&env);
    let contract_id = env.register(WordleContract, (&admin, &hub_addr, &verifier_addr));
    let client = WordleContractClient::new(&env, &contract_id);

    let word_setter = Address::generate(&env);
    let guesser = Address::generate(&env);
    let word_commitment = BytesN::from_array(&env, &[11u8; 32]);

    (env, client, hub, word_setter, guesser, word_commitment)
}

fn assert_wordle_error<T, E>(
    result: &Result<Result<T, E>, Result<Error, soroban_sdk::InvokeError>>,
    expected_error: Error,
) {
    match result {
        Err(Ok(actual_error)) => assert_eq!(*actual_error, expected_error),
        _ => panic!("Expected specific contract error"),
    }
}

fn valid_proof(env: &Env) -> Bytes {
    Bytes::from_array(env, &[1u8])
}

fn invalid_proof(env: &Env) -> Bytes {
    Bytes::from_array(env, &[0u8])
}

fn make_guess(env: &Env, letters: [u8; 5]) -> BytesN<5> {
    BytesN::from_array(env, &letters)
}

fn make_feedback(env: &Env, statuses: [u32; 5]) -> Vec<u32> {
    let mut feedback = Vec::new(env);
    for s in statuses.iter() {
        feedback.push_back(*s);
    }
    feedback
}

fn resolve_pending(
    client: &WordleContractClient<'static>,
    session_id: u32,
    word_setter: &Address,
    guesser: &Address,
    guess_letters: &BytesN<5>,
    feedback: &Vec<u32>,
    is_correct: bool,
    word_commitment: &BytesN<32>,
    proof: &Bytes,
) {
    let hash = client.build_public_inputs_hash(
        &session_id,
        word_setter,
        guesser,
        guess_letters,
        feedback,
        &is_correct,
        word_commitment,
    );

    client.resolve_guess(&session_id, word_setter, feedback, &is_correct, proof, &hash);
}

// ==================== Test Cases ====================

#[test]
fn test_start_commit_guess_resolve_flow() {
    let (env, client, hub, word_setter, guesser, word_commitment) = setup_test();

    let session_id = 1u32;
    let points = 100_0000000i128;

    // Start game
    client.start_game(&session_id, &word_setter, &guesser, &points, &points);
    assert!(hub.was_started(&session_id));

    let before = client.get_game(&session_id);
    assert_eq!(before.phase, GamePhase::WaitingForWord);

    // Commit word
    client.commit_word(&session_id, &word_setter, &word_commitment);

    let in_progress = client.get_game(&session_id);
    assert_eq!(in_progress.phase, GamePhase::InProgress);

    // Submit guess: "HELLO" -> H=7, E=4, L=11, L=11, O=14
    let guess = make_guess(&env, [7, 4, 11, 11, 14]);
    client.guess(&session_id, &guesser, &guess);

    let with_pending = client.get_game(&session_id);
    assert!(with_pending.pending_guess.is_some());

    // Resolve with all wrong feedback
    let feedback = make_feedback(&env, [ABSENT, ABSENT, ABSENT, ABSENT, ABSENT]);
    resolve_pending(
        &client,
        session_id,
        &word_setter,
        &guesser,
        &guess,
        &feedback,
        false,
        &word_commitment,
        &valid_proof(&env),
    );

    let after = client.get_game(&session_id);
    assert_eq!(after.guess_count, 1);
    assert!(after.pending_guess.is_none());
    assert_eq!(after.phase, GamePhase::InProgress);
}

#[test]
fn test_guesser_wins_on_correct_guess() {
    let (env, client, hub, word_setter, guesser, word_commitment) = setup_test();

    let session_id = 2u32;
    client.start_game(&session_id, &word_setter, &guesser, &1, &1);
    client.commit_word(&session_id, &word_setter, &word_commitment);

    let guess = make_guess(&env, [0, 1, 2, 3, 4]);
    client.guess(&session_id, &guesser, &guess);

    let feedback = make_feedback(&env, [CORRECT, CORRECT, CORRECT, CORRECT, CORRECT]);
    resolve_pending(
        &client,
        session_id,
        &word_setter,
        &guesser,
        &guess,
        &feedback,
        true,
        &word_commitment,
        &valid_proof(&env),
    );

    let game = client.get_game(&session_id);
    assert_eq!(game.phase, GamePhase::Ended);
    assert_eq!(game.winner, Some(guesser));
    assert!(hub.was_ended(&session_id));
}

#[test]
fn test_word_setter_wins_after_6_failed_guesses() {
    let (env, client, hub, word_setter, guesser, word_commitment) = setup_test();

    let session_id = 3u32;
    client.start_game(&session_id, &word_setter, &guesser, &1, &1);
    client.commit_word(&session_id, &word_setter, &word_commitment);

    let feedback = make_feedback(&env, [ABSENT, ABSENT, ABSENT, ABSENT, ABSENT]);

    for i in 0..6u8 {
        let guess = make_guess(&env, [i, i, i, i, i]);
        client.guess(&session_id, &guesser, &guess);
        resolve_pending(
            &client,
            session_id,
            &word_setter,
            &guesser,
            &guess,
            &feedback,
            false,
            &word_commitment,
            &valid_proof(&env),
        );
    }

    let game = client.get_game(&session_id);
    assert_eq!(game.phase, GamePhase::Ended);
    assert_eq!(game.winner, Some(word_setter));
    assert_eq!(game.guess_count, 6);
    assert!(hub.was_ended(&session_id));
}

#[test]
fn test_cannot_guess_after_game_ended() {
    let (env, client, _hub, word_setter, guesser, word_commitment) = setup_test();

    let session_id = 4u32;
    client.start_game(&session_id, &word_setter, &guesser, &1, &1);
    client.commit_word(&session_id, &word_setter, &word_commitment);

    let feedback = make_feedback(&env, [ABSENT, ABSENT, ABSENT, ABSENT, ABSENT]);

    // Use all 6 guesses
    for i in 0..6u8 {
        let guess = make_guess(&env, [i, i, i, i, i]);
        client.guess(&session_id, &guesser, &guess);
        resolve_pending(
            &client,
            session_id,
            &word_setter,
            &guesser,
            &guess,
            &feedback,
            false,
            &word_commitment,
            &valid_proof(&env),
        );
    }

    // Try to guess again - should fail
    let guess = make_guess(&env, [6, 6, 6, 6, 6]);
    let result = client.try_guess(&session_id, &guesser, &guess);
    assert_wordle_error(&result, Error::GameAlreadyEnded);
}

#[test]
fn test_reject_invalid_letter_value() {
    let (env, client, _hub, word_setter, guesser, word_commitment) = setup_test();

    let session_id = 5u32;
    client.start_game(&session_id, &word_setter, &guesser, &1, &1);
    client.commit_word(&session_id, &word_setter, &word_commitment);

    // Letter value 26 is out of range (valid: 0-25)
    let invalid_guess = make_guess(&env, [0, 1, 2, 3, 26]);
    let result = client.try_guess(&session_id, &guesser, &invalid_guess);
    assert_wordle_error(&result, Error::InvalidLetterValue);
}

#[test]
fn test_reject_invalid_hash_or_proof() {
    let (env, client, _hub, word_setter, guesser, word_commitment) = setup_test();

    let session_id = 6u32;
    client.start_game(&session_id, &word_setter, &guesser, &1, &1);
    client.commit_word(&session_id, &word_setter, &word_commitment);

    let guess = make_guess(&env, [0, 1, 2, 3, 4]);
    client.guess(&session_id, &guesser, &guess);

    let feedback = make_feedback(&env, [ABSENT, ABSENT, ABSENT, ABSENT, ABSENT]);

    // Wrong hash
    let wrong_hash = BytesN::from_array(&env, &[9u8; 32]);
    let bad_hash_result = client.try_resolve_guess(
        &session_id,
        &word_setter,
        &feedback,
        &false,
        &valid_proof(&env),
        &wrong_hash,
    );
    assert_wordle_error(&bad_hash_result, Error::InvalidPublicInputsHash);

    // Invalid proof
    let valid_hash = client.build_public_inputs_hash(
        &session_id,
        &word_setter,
        &guesser,
        &guess,
        &feedback,
        &false,
        &word_commitment,
    );
    let bad_proof_result = client.try_resolve_guess(
        &session_id,
        &word_setter,
        &feedback,
        &false,
        &invalid_proof(&env),
        &valid_hash,
    );
    assert_wordle_error(&bad_proof_result, Error::InvalidProof);
}

#[test]
fn test_only_word_setter_can_commit() {
    let (_env, client, _hub, word_setter, guesser, word_commitment) = setup_test();

    let session_id = 7u32;
    client.start_game(&session_id, &word_setter, &guesser, &1, &1);

    let result = client.try_commit_word(&session_id, &guesser, &word_commitment);
    assert_wordle_error(&result, Error::NotWordSetter);
}

#[test]
fn test_only_guesser_can_guess() {
    let (env, client, _hub, word_setter, guesser, word_commitment) = setup_test();

    let session_id = 8u32;
    client.start_game(&session_id, &word_setter, &guesser, &1, &1);
    client.commit_word(&session_id, &word_setter, &word_commitment);

    let guess = make_guess(&env, [0, 1, 2, 3, 4]);
    let result = client.try_guess(&session_id, &word_setter, &guess);
    assert_wordle_error(&result, Error::NotGuesser);
}

#[test]
fn test_cannot_guess_before_word_committed() {
    let (env, client, _hub, word_setter, guesser, _word_commitment) = setup_test();

    let session_id = 9u32;
    client.start_game(&session_id, &word_setter, &guesser, &1, &1);

    let guess = make_guess(&env, [0, 1, 2, 3, 4]);
    let result = client.try_guess(&session_id, &guesser, &guess);
    assert_wordle_error(&result, Error::InvalidPhase);
}

#[test]
fn test_cannot_have_two_pending_guesses() {
    let (env, client, _hub, word_setter, guesser, word_commitment) = setup_test();

    let session_id = 10u32;
    client.start_game(&session_id, &word_setter, &guesser, &1, &1);
    client.commit_word(&session_id, &word_setter, &word_commitment);

    let guess1 = make_guess(&env, [0, 1, 2, 3, 4]);
    client.guess(&session_id, &guesser, &guess1);

    let guess2 = make_guess(&env, [5, 6, 7, 8, 9]);
    let result = client.try_guess(&session_id, &guesser, &guess2);
    assert_wordle_error(&result, Error::PendingGuessExists);
}

#[test]
fn test_self_play_not_allowed() {
    let (_env, client, _hub, word_setter, _guesser, _word_commitment) = setup_test();

    let session_id = 11u32;
    let result = client.try_start_game(&session_id, &word_setter, &word_setter, &1, &1);
    assert_wordle_error(&result, Error::SelfPlayNotAllowed);
}

#[test]
fn test_feedback_with_present_and_correct() {
    let (env, client, _hub, word_setter, guesser, word_commitment) = setup_test();

    let session_id = 12u32;
    client.start_game(&session_id, &word_setter, &guesser, &1, &1);
    client.commit_word(&session_id, &word_setter, &word_commitment);

    // Guess: APPLE -> A=0, P=15, P=15, L=11, E=4
    let guess = make_guess(&env, [0, 15, 15, 11, 4]);
    client.guess(&session_id, &guesser, &guess);

    // Feedback: A correct, first P present, second P absent, L correct, E present
    let feedback = make_feedback(&env, [CORRECT, PRESENT, ABSENT, CORRECT, PRESENT]);
    resolve_pending(
        &client,
        session_id,
        &word_setter,
        &guesser,
        &guess,
        &feedback,
        false,
        &word_commitment,
        &valid_proof(&env),
    );

    let game = client.get_game(&session_id);
    assert_eq!(game.guess_count, 1);

    let stored_feedback = game.feedbacks.get(0).unwrap();
    assert_eq!(stored_feedback.get(0).unwrap(), CORRECT);
    assert_eq!(stored_feedback.get(1).unwrap(), PRESENT);
    assert_eq!(stored_feedback.get(2).unwrap(), ABSENT);
    assert_eq!(stored_feedback.get(3).unwrap(), CORRECT);
    assert_eq!(stored_feedback.get(4).unwrap(), PRESENT);
}

#[test]
fn test_rules_expose_wordle_settings() {
    let (_env, client, _hub, _word_setter, _guesser, _word_commitment) = setup_test();

    let rules = client.get_rules();
    assert_eq!(rules.word_length, 5);
    assert_eq!(rules.max_guesses, 6);
    assert_eq!(rules.alphabet_size, 26);
}

#[test]
fn test_invalid_feedback_length_rejected() {
    let (env, client, _hub, word_setter, guesser, word_commitment) = setup_test();

    let session_id = 13u32;
    client.start_game(&session_id, &word_setter, &guesser, &1, &1);
    client.commit_word(&session_id, &word_setter, &word_commitment);

    let guess = make_guess(&env, [0, 1, 2, 3, 4]);
    client.guess(&session_id, &guesser, &guess);

    // Wrong feedback length (4 instead of 5)
    let mut short_feedback = Vec::new(&env);
    short_feedback.push_back(ABSENT);
    short_feedback.push_back(ABSENT);
    short_feedback.push_back(ABSENT);
    short_feedback.push_back(ABSENT);

    let dummy_hash = BytesN::from_array(&env, &[0u8; 32]);
    let result = client.try_resolve_guess(
        &session_id,
        &word_setter,
        &short_feedback,
        &false,
        &valid_proof(&env),
        &dummy_hash,
    );
    assert_wordle_error(&result, Error::InvalidFeedbackLength);
}

#[test]
fn test_invalid_feedback_value_rejected() {
    let (env, client, _hub, word_setter, guesser, word_commitment) = setup_test();

    let session_id = 14u32;
    client.start_game(&session_id, &word_setter, &guesser, &1, &1);
    client.commit_word(&session_id, &word_setter, &word_commitment);

    let guess = make_guess(&env, [0, 1, 2, 3, 4]);
    client.guess(&session_id, &guesser, &guess);

    // Invalid feedback value (3 is not valid, only 0, 1, 2)
    let mut invalid_feedback = Vec::new(&env);
    invalid_feedback.push_back(ABSENT);
    invalid_feedback.push_back(ABSENT);
    invalid_feedback.push_back(3); // Invalid!
    invalid_feedback.push_back(ABSENT);
    invalid_feedback.push_back(ABSENT);

    let dummy_hash = BytesN::from_array(&env, &[0u8; 32]);
    let result = client.try_resolve_guess(
        &session_id,
        &word_setter,
        &invalid_feedback,
        &false,
        &valid_proof(&env),
        &dummy_hash,
    );
    assert_wordle_error(&result, Error::InvalidFeedbackValue);
}
