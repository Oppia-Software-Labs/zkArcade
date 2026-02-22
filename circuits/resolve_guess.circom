pragma circom 2.1.9;

include "./wordle_utils.circom";

/// Verifies that the feedback for a Wordle guess is correct
///
/// Feedback values:
/// - 0 (ABSENT/Gray): Letter not in word OR all occurrences already matched
/// - 1 (PRESENT/Yellow): Letter in word but wrong position
/// - 2 (CORRECT/Green): Letter in correct position
///
/// Public inputs (15 total):
/// - word_commitment_hi, word_commitment_lo (split 256-bit commitment)
/// - public_inputs_hash_hi, public_inputs_hash_lo (for binding to on-chain context)
/// - guess[5] (the guessed letters, 0-25)
/// - feedback[5] (the feedback, 0-2)
/// - is_correct (1 if all letters match, 0 otherwise)
template ResolveGuess() {
    // Private inputs (word setter's secret)
    signal input word[5];
    signal input salt;

    // Public inputs
    signal input guess[5];
    signal input feedback[5];
    signal input is_correct;
    signal input word_commitment_hi;
    signal input word_commitment_lo;
    signal input public_inputs_hash_hi;
    signal input public_inputs_hash_lo;

    // 1. Validate all inputs are in range
    component wordRange[5];
    component guessRange[5];
    component feedbackRange[5];

    for (var i = 0; i < 5; i++) {
        wordRange[i] = AssertInRange(26);
        wordRange[i].in <== word[i];

        guessRange[i] = AssertInRange(26);
        guessRange[i].in <== guess[i];

        feedbackRange[i] = AssertInRange(3); // 0, 1, or 2
        feedbackRange[i].in <== feedback[i];
    }

    component isCorrectBool = AssertBoolean();
    isCorrectBool.in <== is_correct;

    // 2. Verify word commitment matches
    component commit = WordCommitment();
    for (var i = 0; i < 5; i++) {
        commit.word[i] <== word[i];
    }
    commit.salt <== salt;

    // Commitment is split into hi/lo limbs (128 bits each)
    var TWO_128 = 340282366920938463463374607431768211456;
    commit.commitment === word_commitment_hi * TWO_128 + word_commitment_lo;

    // 3. Check exact matches (GREEN/CORRECT = 2)
    component exactMatch[5];
    component isGreen[5];

    for (var i = 0; i < 5; i++) {
        exactMatch[i] = IsEqual();
        exactMatch[i].a <== word[i];
        exactMatch[i].b <== guess[i];

        isGreen[i] = IsEqual();
        isGreen[i].a <== feedback[i];
        isGreen[i].b <== 2;

        // If feedback is GREEN, there MUST be an exact match
        isGreen[i].out * (1 - exactMatch[i].out) === 0;

        // If there's an exact match, feedback MUST be GREEN
        exactMatch[i].out * (1 - isGreen[i].out) === 0;
    }

    // 4. Verify is_correct: all 5 positions must be exact matches
    signal allMatchProduct[6];
    allMatchProduct[0] <== 1;
    for (var i = 0; i < 5; i++) {
        allMatchProduct[i + 1] <== allMatchProduct[i] * exactMatch[i].out;
    }
    is_correct === allMatchProduct[5];

    // 5. Verify YELLOW (PRESENT = 1) and GRAY (ABSENT = 0) feedback
    //
    // For each position i:
    // - If feedback[i] == 1 (YELLOW):
    //   - guess[i] != word[i] (not exact match, already verified above)
    //   - guess[i] appears in word at some other position j where guess[j] != word[j]
    //   - The count of guess[i] in remaining positions > count already matched by GREEN
    //
    // - If feedback[i] == 0 (GRAY):
    //   - guess[i] doesn't appear in any unmatched position of word

    component isYellow[5];
    component isGray[5];

    for (var i = 0; i < 5; i++) {
        isYellow[i] = IsEqual();
        isYellow[i].a <== feedback[i];
        isYellow[i].b <== 1;

        isGray[i] = IsEqual();
        isGray[i].a <== feedback[i];
        isGray[i].b <== 0;
    }

    // For each guess letter, count how many times it appears in the word
    // at positions that are NOT exact matches (all declarations at top for Circom 2.x)
    component letterInWord[5][5];
    signal letterMatch[5][5];
    signal availableCount[5];
    signal partialAvailable[5][6];

    for (var i = 0; i < 5; i++) {
        partialAvailable[i][0] <== 0;

        for (var j = 0; j < 5; j++) {
            letterInWord[i][j] = IsEqual();
            letterInWord[i][j].a <== guess[i];
            letterInWord[i][j].b <== word[j];

            letterMatch[i][j] <== letterInWord[i][j].out * (1 - exactMatch[j].out);
            partialAvailable[i][j + 1] <== partialAvailable[i][j] + letterMatch[i][j];
        }

        availableCount[i] <== partialAvailable[i][5];
    }

    // Count how many times each letter has been "used" by earlier positions
    component sameLetterBefore[5][5];
    signal usedBefore[5];
    signal partialUsed[5][6];
    signal isEarlier[5][5];
    component feedbackGE1[5][5];
    signal hasColoredFeedback[5][5];
    signal usedAtJ[5][5];
    signal sameAndEarlier[5][5];  // sameLetterBefore * isEarlier (quadratic)

    for (var i = 0; i < 5; i++) {
        partialUsed[i][0] <== 0;

        for (var j = 0; j < 5; j++) {
            sameLetterBefore[i][j] = IsEqual();
            sameLetterBefore[i][j].a <== guess[i];
            sameLetterBefore[i][j].b <== guess[j];

            isEarlier[i][j] <== (j < i) ? 1 : 0;

            feedbackGE1[i][j] = IsZero();
            feedbackGE1[i][j].in <== feedback[j];
            hasColoredFeedback[i][j] <== 1 - feedbackGE1[i][j].out;

            sameAndEarlier[i][j] <== sameLetterBefore[i][j].out * isEarlier[i][j];
            usedAtJ[i][j] <== sameAndEarlier[i][j] * hasColoredFeedback[i][j];
            partialUsed[i][j + 1] <== partialUsed[i][j] + usedAtJ[i][j];
        }

        usedBefore[i] <== partialUsed[i][5];
    }

    // Verify YELLOW and GRAY constraints.
    // In the field, (availableCount - usedBefore) wraps when negative, so IsZero gives wrong result.
    // YELLOW => availableCount > usedBefore  => (availableCount - usedBefore - 1) in [0, 4]
    // GRAY   => availableCount <= usedBefore => (usedBefore - availableCount) in [0, 5]
    signal inYellow[5];
    signal inGray[5];
    component yellowRange[5];
    component grayRange[5];

    for (var i = 0; i < 5; i++) {
        inYellow[i] <== isYellow[i].out * (availableCount[i] - usedBefore[i] - 1);
        yellowRange[i] = AssertInRange(5);
        yellowRange[i].in <== inYellow[i];

        inGray[i] <== isGray[i].out * (usedBefore[i] - availableCount[i]);
        grayRange[i] = AssertInRange(6);
        grayRange[i].in <== inGray[i];
    }

    // 6. Binding witness for public inputs hash
    // TODO(security): Add keccak constraints to bind public_inputs_hash to
    // (session_id, word_setter, guesser, guess, feedback, is_correct, word_commitment)
    signal hash_binding_witness;
    hash_binding_witness <== public_inputs_hash_hi + public_inputs_hash_lo;
}

component main {public [
    guess,
    feedback,
    is_correct,
    word_commitment_hi,
    word_commitment_lo,
    public_inputs_hash_hi,
    public_inputs_hash_lo
]} = ResolveGuess();
