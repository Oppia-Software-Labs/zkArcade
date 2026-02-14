pragma circom 2.1.9;

include "./battleship_utils.circom";

template BoardCommit() {
    signal input ship_x[5];
    signal input ship_y[5];
    signal input ship_dir[5];
    signal input salt;

    signal output board_commitment;

    component board = BoardLayout();
    for (var i = 0; i < 5; i++) {
        board.ship_x[i] <== ship_x[i];
        board.ship_y[i] <== ship_y[i];
        board.ship_dir[i] <== ship_dir[i];
    }
    board.salt <== salt;

    board_commitment <== board.board_commitment;
}

component main = BoardCommit();
