pragma circom 2.1.9;

include "circomlib/circuits/poseidon.circom";

template AssertBoolean() {
    signal input in;
    in * (in - 1) === 0;
}

template IsZero() {
    signal input in;
    signal output out;
    signal inv;

    inv <-- in != 0 ? 1 / in : 0;
    out <== 1 - in * inv;

    in * out === 0;
    out * (out - 1) === 0;
}

template IsEqual() {
    signal input a;
    signal input b;
    signal output out;

    component z = IsZero();
    z.in <== a - b;
    out <== z.out;
}

template AssertNonZero() {
    signal input in;
    signal inv;

    inv <-- in != 0 ? 1 / in : 0;
    in * inv === 1;
}

template AssertInRange(maxExclusive) {
    signal input in;
    signal poly[maxExclusive + 1];

    poly[0] <== 1;
    for (var i = 0; i < maxExclusive; i++) {
        poly[i + 1] <== poly[i] * (in - i);
    }

    poly[maxExclusive] === 0;
}

template BoardLayout() {
    signal input ship_x[5];
    signal input ship_y[5];
    signal input ship_dir[5]; // 0 = vertical, 1 = horizontal
    signal input salt;

    signal output cell_idx[17];
    signal output board_commitment;

    var shipLens[5] = [5, 4, 3, 3, 2];

    component dirBool[5];
    component startXRange[5];
    component startYRange[5];

    for (var s = 0; s < 5; s++) {
        dirBool[s] = AssertBoolean();
        dirBool[s].in <== ship_dir[s];

        startXRange[s] = AssertInRange(10);
        startXRange[s].in <== ship_x[s];

        startYRange[s] = AssertInRange(10);
        startYRange[s].in <== ship_y[s];
    }

    signal cell_x[17];
    signal cell_y[17];

    component cellXRange[17];
    component cellYRange[17];

    var offset = 0;
    for (var s = 0; s < 5; s++) {
        for (var k = 0; k < shipLens[s]; k++) {
            // Horizontal ships advance on X, vertical ships advance on Y.
            cell_x[offset + k] <== ship_x[s] + ship_dir[s] * k;
            cell_y[offset + k] <== ship_y[s] + (1 - ship_dir[s]) * k;

            cellXRange[offset + k] = AssertInRange(10);
            cellXRange[offset + k].in <== cell_x[offset + k];

            cellYRange[offset + k] = AssertInRange(10);
            cellYRange[offset + k].in <== cell_y[offset + k];

            cell_idx[offset + k] <== cell_y[offset + k] * 10 + cell_x[offset + k];
        }
        offset += shipLens[s];
    }

    // No overlap: all 17 occupied coordinates must be pairwise distinct.
    component distinct[136];
    var d = 0;
    for (var i = 0; i < 17; i++) {
        for (var j = i + 1; j < 17; j++) {
            distinct[d] = AssertNonZero();
            distinct[d].in <== cell_idx[i] - cell_idx[j];
            d++;
        }
    }

    component h = Poseidon(18);
    for (var i = 0; i < 17; i++) {
        h.inputs[i] <== cell_idx[i];
    }
    h.inputs[17] <== salt;

    board_commitment <== h.out;
}
