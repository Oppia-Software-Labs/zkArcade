use soroban_sdk::{Env, Vec};

use super::errors::DomainError;
use super::word::WORD_LENGTH;

/// Feedback status for each letter position
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum FeedbackStatus {
    /// Gray - Letter not in word
    Absent = 0,
    /// Yellow - Letter in word but wrong position
    Present = 1,
    /// Green - Letter in correct position
    Correct = 2,
}

impl FeedbackStatus {
    pub fn from_u32(value: u32) -> Result<Self, DomainError> {
        match value {
            0 => Ok(FeedbackStatus::Absent),
            1 => Ok(FeedbackStatus::Present),
            2 => Ok(FeedbackStatus::Correct),
            _ => Err(DomainError::InvalidFeedbackValue),
        }
    }

    pub fn as_u32(&self) -> u32 {
        *self as u32
    }
}

/// Represents feedback for a complete guess (5 positions)
#[derive(Clone, Debug)]
pub struct Feedback {
    statuses: [FeedbackStatus; 5],
}

impl Feedback {
    /// Creates feedback from a Vec<u32>
    pub fn from_vec(feedback: &Vec<u32>) -> Result<Self, DomainError> {
        if feedback.len() != WORD_LENGTH {
            return Err(DomainError::InvalidFeedbackLength);
        }

        let mut statuses = [FeedbackStatus::Absent; 5];
        for i in 0..5 {
            let value = feedback.get(i as u32).unwrap();
            statuses[i] = FeedbackStatus::from_u32(value)?;
        }

        Ok(Self { statuses })
    }

    /// Converts feedback to Vec<u32> for storage
    pub fn to_vec(&self, env: &Env) -> Vec<u32> {
        let mut result = Vec::new(env);
        for status in self.statuses.iter() {
            result.push_back(status.as_u32());
        }
        result
    }

    /// Returns the statuses array
    pub fn statuses(&self) -> &[FeedbackStatus; 5] {
        &self.statuses
    }

    /// Checks if all positions are correct (word guessed)
    pub fn is_all_correct(&self) -> bool {
        self.statuses
            .iter()
            .all(|s| *s == FeedbackStatus::Correct)
    }

    /// Validates that feedback matches is_correct flag
    pub fn validate_correctness(&self, is_correct: bool) -> Result<(), DomainError> {
        if is_correct != self.is_all_correct() {
            return Err(DomainError::InvalidFeedbackValue);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_feedback_status_conversion() {
        assert_eq!(FeedbackStatus::from_u32(0).unwrap(), FeedbackStatus::Absent);
        assert_eq!(
            FeedbackStatus::from_u32(1).unwrap(),
            FeedbackStatus::Present
        );
        assert_eq!(
            FeedbackStatus::from_u32(2).unwrap(),
            FeedbackStatus::Correct
        );
        assert!(FeedbackStatus::from_u32(3).is_err());
    }
}
