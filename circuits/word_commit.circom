pragma circom 2.1.9;

include "./wordle_utils.circom";

/// Commits to a 5-letter word using Poseidon hash
/// Input: word[5] (letters 0-25, A-Z), salt
/// Output: word_commitment
template WordCommit() {
    signal input word[5];
    signal input salt;

    signal output word_commitment;

    component commit = WordCommitment();
    for (var i = 0; i < 5; i++) {
        commit.word[i] <== word[i];
    }
    commit.salt <== salt;

    word_commitment <== commit.commitment;
}

component main = WordCommit();
