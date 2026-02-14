pragma circom 2.1.9;

include "./battleship_utils.circom";

template ResolveShot() {
    signal input ship_x[5];
    signal input ship_y[5];
    signal input ship_dir[5];
    signal input salt;

    // Prior hit state for the 17 ship cells in BoardLayout order.
    // NOTE: Production integration must bind this to on-chain shot history.
    signal input prior_hits[17];

    signal input shot_x;
    signal input shot_y;
    signal input is_hit;
    signal input sunk_ship; // 0 = none, 1..5 = Carrier..Destroyer
    signal input board_commitment;

    // Split u256 hash limbs (contract side uses keccak). These are exposed so
    // the verifier adapter can bind to `public_inputs_hash` from the contract call.
    signal input public_inputs_hash_hi;
    signal input public_inputs_hash_lo;

    component board = BoardLayout();
    for (var i = 0; i < 5; i++) {
        board.ship_x[i] <== ship_x[i];
        board.ship_y[i] <== ship_y[i];
        board.ship_dir[i] <== ship_dir[i];
    }
    board.salt <== salt;
    board.board_commitment === board_commitment;

    component hitBool = AssertBoolean();
    hitBool.in <== is_hit;

    component shotXRange = AssertInRange(10);
    shotXRange.in <== shot_x;

    component shotYRange = AssertInRange(10);
    shotYRange.in <== shot_y;

    component sunkRange = AssertInRange(6);
    sunkRange.in <== sunk_ship;

    component priorHitBool[17];
    for (var i = 0; i < 17; i++) {
        priorHitBool[i] = AssertBoolean();
        priorHitBool[i].in <== prior_hits[i];
    }

    signal shot_idx;
    shot_idx <== shot_y * 10 + shot_x;

    component shotMatches[17];
    signal shot_match[17];
    for (var i = 0; i < 17; i++) {
        shotMatches[i] = IsEqual();
        shotMatches[i].a <== shot_idx;
        shotMatches[i].b <== board.cell_idx[i];
        shot_match[i] <== shotMatches[i].out;

        // Cannot report a hit on a ship cell that was already marked hit.
        prior_hits[i] * shot_match[i] === 0;
    }

    signal hit_sum[18];
    hit_sum[0] <== 0;
    for (var i = 0; i < 17; i++) {
        hit_sum[i + 1] <== hit_sum[i] + shot_match[i];
    }
    hit_sum[17] === is_hit;

    signal prior_cum[18];
    signal shot_cum[18];
    prior_cum[0] <== 0;
    shot_cum[0] <== 0;
    for (var i = 0; i < 17; i++) {
        prior_cum[i + 1] <== prior_cum[i] + prior_hits[i];
        shot_cum[i + 1] <== shot_cum[i] + shot_match[i];
    }

    var shipLens[5] = [5, 4, 3, 3, 2];
    var shipOffset[5] = [0, 5, 9, 12, 15];

    signal ship_hits_before[5];
    signal ship_shot_hit[5];
    signal ship_sunk_now[5];

    component eqBefore[5];
    component eqShotOne[5];

    for (var s = 0; s < 5; s++) {
        var o = shipOffset[s];
        var l = shipLens[s];

        ship_hits_before[s] <== prior_cum[o + l] - prior_cum[o];
        ship_shot_hit[s] <== shot_cum[o + l] - shot_cum[o];

        eqBefore[s] = IsEqual();
        eqBefore[s].a <== ship_hits_before[s];
        eqBefore[s].b <== l - 1;

        eqShotOne[s] = IsEqual();
        eqShotOne[s].a <== ship_shot_hit[s];
        eqShotOne[s].b <== 1;

        // Newly sunk iff this shot is on that ship and it had len-1 prior hits.
        ship_sunk_now[s] <== eqBefore[s].out * eqShotOne[s].out;
    }

    component eqNone = IsEqual();
    eqNone.a <== sunk_ship;
    eqNone.b <== 0;

    signal sunk_sum[6];
    sunk_sum[0] <== 0;

    component eqShipTag[5];
    for (var s = 0; s < 5; s++) {
        eqShipTag[s] = IsEqual();
        eqShipTag[s].a <== sunk_ship;
        eqShipTag[s].b <== s + 1;

        ship_sunk_now[s] === eqShipTag[s].out;
        sunk_sum[s + 1] <== sunk_sum[s] + ship_sunk_now[s];
    }

    // No sunk ship => 0, otherwise exactly one sunk ship tag.
    sunk_sum[5] === 1 - eqNone.out;

    // If a ship is marked sunk, this shot must be a hit.
    sunk_sum[5] * (1 - is_hit) === 0;

    // TODO(security): add keccak gadget constraints so (session, players, shot,
    // outcome, board_commitment) are constrained to `public_inputs_hash_hi/lo`
    // exactly like `build_public_inputs_hash` in the Soroban contract.
    signal hash_binding_witness;
    hash_binding_witness <== public_inputs_hash_hi + public_inputs_hash_lo;
}

component main = ResolveShot();
