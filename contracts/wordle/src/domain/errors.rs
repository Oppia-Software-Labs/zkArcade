use soroban_sdk::contracterror;

/// Domain-specific errors for Wordle game logic
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum DomainError {
    // Game lifecycle errors
    GameNotFound = 1,
    GameAlreadyExists = 2,
    GameAlreadyEnded = 3,
    InvalidPhase = 4,

    // Player errors
    NotPlayer = 5,
    NotWordSetter = 6,
    NotGuesser = 7,
    SelfPlayNotAllowed = 8,

    // Word errors
    WordAlreadyCommitted = 9,
    WordNotCommitted = 10,
    InvalidLetterValue = 11,

    // Guess errors
    PendingGuessExists = 12,
    NoPendingGuess = 13,
    MaxGuessesReached = 14,

    // Feedback errors
    InvalidFeedbackLength = 15,
    InvalidFeedbackValue = 16,

    // Verification errors
    InvalidPublicInputsHash = 17,
    InvalidProof = 18,
}
