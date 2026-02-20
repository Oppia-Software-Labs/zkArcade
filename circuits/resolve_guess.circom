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
    // at positions that are NOT exact matches
    component letterInWord[5][5];
    signal letterMatch[5][5];
    signal availableCount[5];

    for (var i = 0; i < 5; i++) {
        signal partialAvailable[6];
        partialAvailable[0] <== 0;

        for (var j = 0; j < 5; j++) {
            letterInWord[i][j] = IsEqual();
            letterInWord[i][j].a <== guess[i];
            letterInWord[i][j].b <== word[j];

            // Only count if this position in word is NOT a green match
            // (word[j] != guess[j])
            letterMatch[i][j] <== letterInWord[i][j].out * (1 - exactMatch[j].out);
            partialAvailable[j + 1] <== partialAvailable[j] + letterMatch[i][j];
        }

        availableCount[i] <== partialAvailable[5];
    }

    // Count how many times each letter has been "used" by earlier positions
    // (either as GREEN or YELLOW)
    component sameLetterBefore[5][5];
    signal usedBefore[5];

    for (var i = 0; i < 5; i++) {
        signal partialUsed[6];
        partialUsed[0] <== 0;

        for (var j = 0; j < 5; j++) {
            sameLetterBefore[i][j] = IsEqual();
            sameLetterBefore[i][j].a <== guess[i];
            sameLetterBefore[i][j].b <== guess[j];

            // Count as used if:
            // - Same letter at earlier position (j < i)
            // - That position has GREEN or YELLOW feedback (feedback[j] >= 1)
            signal isEarlier;
            isEarlier <== (j < i) ? 1 : 0;

            component feedbackGE1 = IsZero();
            feedbackGE1.in <== feedback[j];
            signal hasColoredFeedback;
            hasColoredFeedback <== 1 - feedbackGE1.out;

            signal usedAtJ;
            usedAtJ <== sameLetterBefore[i][j].out * isEarlier * hasColoredFeedback;
            partialUsed[j + 1] <== partialUsed[j] + usedAtJ;
        }

        usedBefore[i] <== partialUsed[5];
    }

    // Verify YELLOW and GRAY constraints
    component availableGtUsed[5];

    for (var i = 0; i < 5; i++) {
        // Check if there are more available occurrences than already used
        availableGtUsed[i] = IsZero();
        availableGtUsed[i].in <== availableCount[i] - usedBefore[i];
        signal hasAvailable;
        hasAvailable <== 1 - availableGtUsed[i].out;

        // If YELLOW: must have available letters AND not exact match
        // (not exact match already enforced by GREEN constraint above)
        isYellow[i].out * (1 - hasAvailable) === 0;

        // If GRAY: must NOT have available letters (after accounting for used)
        // OR the position itself has an exact match (which would be GREEN, not GRAY)
        // Since we already enforce exact match => GREEN, we just check no available
        isGray[i].out * hasAvailable === 0;
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
