use soroban_sdk::{contracttype, Address, Vec};

/// Result of resolving a guess (returned to frontend)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GuessResult {
    /// Which guess this was (1-6)
    pub guess_number: u32,
    /// Feedback for each letter (0=absent, 1=present, 2=correct)
    pub feedback: Vec<u32>,
    /// Whether the guess was correct
    pub is_correct: bool,
    /// Winner address if game ended
    pub winner: Option<Address>,
    /// Whether the game has ended
    pub game_ended: bool,
}
