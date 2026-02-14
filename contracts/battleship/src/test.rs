#![cfg(test)]

use crate::{BattleshipContract, BattleshipContractClient, Error, GamePhase};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, BytesN, Env};

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
        _board_commitment: BytesN<32>,
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
    BattleshipContractClient<'static>,
    MockGameHubClient<'static>,
    Address,
    Address,
    BytesN<32>,
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
    let contract_id = env.register(BattleshipContract, (&admin, &hub_addr, &verifier_addr));
    let client = BattleshipContractClient::new(&env, &contract_id);

    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    let board1 = BytesN::from_array(&env, &[11u8; 32]);
    let board2 = BytesN::from_array(&env, &[22u8; 32]);

    (env, client, hub, player1, player2, board1, board2)
}

fn assert_battleship_error<T, E>(
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

fn resolve_pending(
    client: &BattleshipContractClient<'static>,
    session_id: u32,
    defender: &Address,
    shooter: &Address,
    x: u32,
    y: u32,
    is_hit: bool,
    sunk_ship: u32,
    board_commitment: &BytesN<32>,
    proof: &Bytes,
) {
    let hash = client.build_public_inputs_hash(
        &session_id,
        defender,
        shooter,
        &x,
        &y,
        &is_hit,
        &sunk_ship,
        board_commitment,
    );

    client.resolve_shot(&session_id, defender, &is_hit, &sunk_ship, proof, &hash);
}

#[test]
fn test_start_commit_fire_resolve_flow() {
    let (env, client, hub, player1, player2, board1, board2) = setup_test();

    let session_id = 1u32;
    let points = 100_0000000;

    client.start_game(&session_id, &player1, &player2, &points, &points);
    assert!(hub.was_started(&session_id));

    let before = client.get_game(&session_id);
    assert_eq!(before.phase, GamePhase::WaitingForBoards);

    client.commit_board(&session_id, &player1, &board1);
    client.commit_board(&session_id, &player2, &board2);

    let in_progress = client.get_game(&session_id);
    assert_eq!(in_progress.phase, GamePhase::InProgress);
    assert_eq!(in_progress.turn, Some(player1.clone()));

    client.fire(&session_id, &player1, &3, &7);
    resolve_pending(
        &client,
        session_id,
        &player2,
        &player1,
        3,
        7,
        true,
        0,
        &board2,
        &valid_proof(&env),
    );

    let after = client.get_game(&session_id);
    assert_eq!(after.hits_on_p2, 1);
    assert_eq!(after.turn, Some(player2));
    assert!(after.pending_shot.is_none());
}

#[test]
fn test_fire_requires_0_to_9_coordinates() {
    let (_env, client, _hub, player1, player2, board1, board2) = setup_test();

    let session_id = 2u32;
    client.start_game(&session_id, &player1, &player2, &1, &1);
    client.commit_board(&session_id, &player1, &board1);
    client.commit_board(&session_id, &player2, &board2);

    let result = client.try_fire(&session_id, &player1, &10, &0);
    assert_battleship_error(&result, Error::InvalidCoordinate);

    let result = client.try_fire(&session_id, &player1, &0, &10);
    assert_battleship_error(&result, Error::InvalidCoordinate);
}

#[test]
fn test_anyone_can_resolve_with_valid_payload() {
    let (env, client, _hub, player1, player2, board1, board2) = setup_test();
    let outsider = Address::generate(&env);

    let session_id = 3u32;
    client.start_game(&session_id, &player1, &player2, &1, &1);
    client.commit_board(&session_id, &player1, &board1);
    client.commit_board(&session_id, &player2, &board2);
    client.fire(&session_id, &player1, &0, &0);

    let hash = client.build_public_inputs_hash(
        &session_id,
        &player2,
        &player1,
        &0,
        &0,
        &false,
        &0,
        &board2,
    );

    // Outsider submits the valid payload; no auth required on resolve_shot.
    let _ = outsider;
    client.resolve_shot(&session_id, &player2, &false, &0, &valid_proof(&env), &hash);

    let game = client.get_game(&session_id);
    assert_eq!(game.turn, Some(player2));
}

#[test]
fn test_reject_invalid_hash_or_proof() {
    let (env, client, _hub, player1, player2, board1, board2) = setup_test();

    let session_id = 4u32;
    client.start_game(&session_id, &player1, &player2, &1, &1);
    client.commit_board(&session_id, &player1, &board1);
    client.commit_board(&session_id, &player2, &board2);
    client.fire(&session_id, &player1, &1, &1);

    let wrong_hash = BytesN::from_array(&env, &[9u8; 32]);
    let bad_hash_result = client.try_resolve_shot(
        &session_id,
        &player2,
        &true,
        &0,
        &valid_proof(&env),
        &wrong_hash,
    );
    assert_battleship_error(&bad_hash_result, Error::InvalidPublicInputsHash);

    let valid_hash = client.build_public_inputs_hash(
        &session_id,
        &player2,
        &player1,
        &1,
        &1,
        &true,
        &0,
        &board2,
    );
    let bad_proof_result = client.try_resolve_shot(
        &session_id,
        &player2,
        &true,
        &0,
        &invalid_proof(&env),
        &valid_hash,
    );
    assert_battleship_error(&bad_proof_result, Error::InvalidProof);
}

#[test]
fn test_ship_sunk_cannot_be_reported_twice() {
    let (env, client, _hub, player1, player2, board1, board2) = setup_test();

    let session_id = 5u32;
    client.start_game(&session_id, &player1, &player2, &1, &1);
    client.commit_board(&session_id, &player1, &board1);
    client.commit_board(&session_id, &player2, &board2);

    client.fire(&session_id, &player1, &2, &2);
    resolve_pending(
        &client,
        session_id,
        &player2,
        &player1,
        2,
        2,
        true,
        5,
        &board2,
        &valid_proof(&env),
    );

    client.fire(&session_id, &player2, &9, &9);
    resolve_pending(
        &client,
        session_id,
        &player1,
        &player2,
        9,
        9,
        false,
        0,
        &board1,
        &valid_proof(&env),
    );

    client.fire(&session_id, &player1, &2, &3);
    let hash = client.build_public_inputs_hash(
        &session_id,
        &player2,
        &player1,
        &2,
        &3,
        &true,
        &5,
        &board2,
    );

    let result =
        client.try_resolve_shot(&session_id, &player2, &true, &5, &valid_proof(&env), &hash);
    assert_battleship_error(&result, Error::ShipAlreadySunk);
}

#[test]
fn test_duplicate_coordinate_rejected_for_same_shooter() {
    let (env, client, _hub, player1, player2, board1, board2) = setup_test();

    let session_id = 6u32;
    client.start_game(&session_id, &player1, &player2, &1, &1);
    client.commit_board(&session_id, &player1, &board1);
    client.commit_board(&session_id, &player2, &board2);

    client.fire(&session_id, &player1, &1, &1);
    resolve_pending(
        &client,
        session_id,
        &player2,
        &player1,
        1,
        1,
        false,
        0,
        &board2,
        &valid_proof(&env),
    );

    client.fire(&session_id, &player2, &0, &0);
    resolve_pending(
        &client,
        session_id,
        &player1,
        &player2,
        0,
        0,
        false,
        0,
        &board1,
        &valid_proof(&env),
    );

    let result = client.try_fire(&session_id, &player1, &1, &1);
    assert_battleship_error(&result, Error::ShotAlreadyResolved);
}

#[test]
fn test_win_at_17_hits_ends_in_game_hub() {
    let (env, client, hub, player1, player2, board1, board2) = setup_test();

    let session_id = 7u32;
    client.start_game(&session_id, &player1, &player2, &1, &1);
    client.commit_board(&session_id, &player1, &board1);
    client.commit_board(&session_id, &player2, &board2);

    let mut p2_index = 0u32;

    for i in 0..17u32 {
        let x1 = i % 10;
        let y1 = i / 10;
        client.fire(&session_id, &player1, &x1, &y1);
        resolve_pending(
            &client,
            session_id,
            &player2,
            &player1,
            x1,
            y1,
            true,
            0,
            &board2,
            &valid_proof(&env),
        );

        if i == 16 {
            break;
        }

        let x2 = 9 - (p2_index % 10);
        let y2 = 9 - (p2_index / 10);
        p2_index += 1;

        client.fire(&session_id, &player2, &x2, &y2);
        resolve_pending(
            &client,
            session_id,
            &player1,
            &player2,
            x2,
            y2,
            false,
            0,
            &board1,
            &valid_proof(&env),
        );
    }

    let game = client.get_game(&session_id);
    assert_eq!(game.phase, GamePhase::Ended);
    assert_eq!(game.winner, Some(player1));
    assert_eq!(game.hits_on_p2, 17);
    assert!(hub.was_ended(&session_id));
}

#[test]
fn test_rules_expose_standard_ship_sizes() {
    let (_env, client, _hub, _player1, _player2, _board1, _board2) = setup_test();

    let rules = client.get_rules();
    assert_eq!(rules.board_size, 10);
    assert_eq!(rules.carrier_len, 5);
    assert_eq!(rules.battleship_len, 4);
    assert_eq!(rules.cruiser_len, 3);
    assert_eq!(rules.submarine_len, 3);
    assert_eq!(rules.destroyer_len, 2);
    assert_eq!(rules.total_ship_cells, 17);
}
