use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    GameNotFound = 1,
    GameAlreadyExists = 2,
    NotPlayer = 3,
    SelfPlayNotAllowed = 4,
    GameAlreadyEnded = 5,
    InvalidPhase = 6,
    BoardAlreadyCommitted = 7,
    BoardNotCommitted = 8,
    NotYourTurn = 9,
    PendingShotExists = 10,
    NoPendingShot = 11,
    InvalidCoordinate = 12,
    ShotAlreadyResolved = 13,
    InvalidDefender = 14,
    InvalidShipType = 15,
    InvalidSunkShip = 16,
    ShipAlreadySunk = 17,
    InvalidPublicInputsHash = 18,
    InvalidProof = 19,
    TooManyHits = 20,
}