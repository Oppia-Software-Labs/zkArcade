pragma circom 2.1.9;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

/// Asserts that input is 0 or 1
template AssertBoolean() {
    signal input in;
    in * (in - 1) === 0;
}

/// Returns 1 if input is 0, else 0
template IsZero() {
    signal input in;
    signal output out;
    signal inv;

    inv <-- in != 0 ? 1 / in : 0;
    out <== 1 - in * inv;

    in * out === 0;
    out * (out - 1) === 0;
}

/// Returns 1 if a == b, else 0
template IsEqual() {
    signal input a;
    signal input b;
    signal output out;

    component z = IsZero();
    z.in <== a - b;
    out <== z.out;
}

/// Asserts that input is in [0, maxExclusive)
template AssertInRange(maxExclusive) {
    signal input in;
    signal poly[maxExclusive + 1];

    poly[0] <== 1;
    for (var i = 0; i < maxExclusive; i++) {
        poly[i + 1] <== poly[i] * (in - i);
    }

    poly[maxExclusive] === 0;
}

/// Computes word commitment: Poseidon(word[0..4], salt)
/// Word letters are in range [0, 25] (A-Z)
template WordCommitment() {
    signal input word[5];
    signal input salt;
    signal output commitment;

    // Validate word letters are in range [0, 25]
    component letterRange[5];
    for (var i = 0; i < 5; i++) {
        letterRange[i] = AssertInRange(26);
        letterRange[i].in <== word[i];
    }

    // Poseidon hash of 5 letters + salt
    component hasher = Poseidon(6);
    for (var i = 0; i < 5; i++) {
        hasher.inputs[i] <== word[i];
    }
    hasher.inputs[5] <== salt;

    commitment <== hasher.out;
}

/// Counts occurrences of a letter in the word
/// Returns count of positions where word[i] == letter
template CountLetter() {
    signal input word[5];
    signal input letter;
    signal output count;

    component eq[5];
    signal partial[6];
    partial[0] <== 0;

    for (var i = 0; i < 5; i++) {
        eq[i] = IsEqual();
        eq[i].a <== word[i];
        eq[i].b <== letter;
        partial[i + 1] <== partial[i] + eq[i].out;
    }

    count <== partial[5];
}

/// For a given position, checks if there's a "green match" (exact position match)
template HasGreenMatch() {
    signal input word[5];
    signal input guess[5];
    signal input position;
    signal output hasMatch;

    component posEq[5];
    component letterEq[5];
    signal matchAtPos[5];
    signal partial[6];
    partial[0] <== 0;

    for (var i = 0; i < 5; i++) {
        posEq[i] = IsEqual();
        posEq[i].a <== position;
        posEq[i].b <== i;

        letterEq[i] = IsEqual();
        letterEq[i].a <== word[i];
        letterEq[i].b <== guess[i];

        matchAtPos[i] <== posEq[i].out * letterEq[i].out;
        partial[i + 1] <== partial[i] + matchAtPos[i];
    }

    hasMatch <== partial[5];
}
