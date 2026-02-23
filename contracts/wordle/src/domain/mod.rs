mod errors;
mod feedback;
pub mod game;
mod word;

pub use errors::DomainError;
pub use feedback::Feedback;
pub use game::{Game, GameOutcome, GamePhase, GameRules};
pub use word::Guess;
