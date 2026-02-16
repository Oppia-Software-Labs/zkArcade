use soroban_sdk::{contracttype, Address, BytesN};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GamePhase {
    WaitingForBoards,
    InProgress,
    Ended,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ShipType {
    Carrier,
    Battleship,
    Cruiser,
    Submarine,
    Destroyer,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShotResult {
    pub is_hit: bool,
    // 0 = none, 1..5 = Carrier..Destroyer
    pub sunk_ship: u32,
    pub winner: Option<Address>,
    pub next_turn: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameRules {
    pub board_size: u32,
    pub carrier_len: u32,
    pub battleship_len: u32,
    pub cruiser_len: u32,
    pub submarine_len: u32,
    pub destroyer_len: u32,
    pub total_ship_cells: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub player1: Address,
    pub player2: Address,
    pub player1_points: i128,
    pub player2_points: i128,
    pub phase: GamePhase,
    pub turn: Option<Address>,
    pub board_commitment_p1: Option<BytesN<32>>,
    pub board_commitment_p2: Option<BytesN<32>>,
    pub pending_shot_shooter: Option<Address>,
    pub pending_shot_x: u32,
    pub pending_shot_y: u32,
    // Bitmaps over 100 cells. Index = y * 10 + x.
    pub shots_p1_to_p2: u128,
    pub shots_p2_to_p1: u128,
    pub hits_on_p1: u32,
    pub hits_on_p2: u32,
    // Bit mask for sunk ships for each player board.
    pub sunk_ships_on_p1: u32,
    pub sunk_ships_on_p2: u32,
    pub winner: Option<Address>,
}
