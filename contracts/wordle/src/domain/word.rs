use soroban_sdk::BytesN;

use super::errors::DomainError;

/// Word length constant
pub const WORD_LENGTH: u32 = 5;

/// Alphabet size (A-Z = 0-25)
pub const ALPHABET_SIZE: u32 = 26;

/// Represents a committed word (hash of word + salt)
pub type WordCommitment = BytesN<32>;

/// Represents the secret word (5 letters, each 0-25)
/// Note: The actual word is never stored on-chain, only committed via hash
#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct Word {
    letters: [u8; 5],
}

#[allow(dead_code)]
impl Word {
    pub fn new(letters: [u8; 5]) -> Result<Self, DomainError> {
        for letter in letters.iter() {
            if *letter >= ALPHABET_SIZE as u8 {
                return Err(DomainError::InvalidLetterValue);
            }
        }
        Ok(Self { letters })
    }

    pub fn letters(&self) -> &[u8; 5] {
        &self.letters
    }
}

/// Represents a guess attempt (5 letters, each 0-25)
#[derive(Clone, Debug)]
pub struct Guess {
    letters: BytesN<5>,
}

impl Guess {
    pub fn new(letters: BytesN<5>) -> Result<Self, DomainError> {
        let arr = letters.to_array();
        for letter in arr.iter() {
            if *letter >= ALPHABET_SIZE as u8 {
                return Err(DomainError::InvalidLetterValue);
            }
        }
        Ok(Self { letters })
    }

    pub fn letters(&self) -> &BytesN<5> {
        &self.letters
    }

    pub fn to_array(&self) -> [u8; 5] {
        self.letters.to_array()
    }
}
