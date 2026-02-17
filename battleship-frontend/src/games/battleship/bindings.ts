import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}

export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CCZU5BW5AMAWP5OFRWANDBIINOZB7IOGGEGNXYBRG6CLPZJQT7MOIOAV",
  }
} as const;

export const Errors = {
  1: {message:"GameNotFound"},
  2: {message:"GameAlreadyExists"},
  3: {message:"NotPlayer"},
  4: {message:"SelfPlayNotAllowed"},
  5: {message:"GameAlreadyEnded"},
  6: {message:"InvalidPhase"},
  7: {message:"BoardAlreadyCommitted"},
  8: {message:"BoardNotCommitted"},
  9: {message:"NotYourTurn"},
  10: {message:"PendingShotExists"},
  11: {message:"NoPendingShot"},
  12: {message:"InvalidCoordinate"},
  13: {message:"ShotAlreadyResolved"},
  14: {message:"InvalidDefender"},
  15: {message:"InvalidShipType"},
  16: {message:"InvalidSunkShip"},
  17: {message:"ShipAlreadySunk"},
  18: {message:"InvalidPublicInputsHash"},
  19: {message:"InvalidProof"},
  20: {message:"TooManyHits"}
};


export interface Game {
  board_commitment_p1: Option<Buffer>;
  board_commitment_p2: Option<Buffer>;
  hits_on_p1: u32;
  hits_on_p2: u32;
  pending_shot_shooter: Option<string>;
  pending_shot_x: u32;
  pending_shot_y: u32;
  phase: GamePhase;
  player1: string;
  player1_points: i128;
  player2: string;
  player2_points: i128;
  shots_p1_to_p2: u128;
  shots_p2_to_p1: u128;
  sunk_ships_on_p1: u32;
  sunk_ships_on_p2: u32;
  turn: Option<string>;
  winner: Option<string>;
}

export type ShipType = {tag: "Carrier", values: void} | {tag: "Battleship", values: void} | {tag: "Cruiser", values: void} | {tag: "Submarine", values: void} | {tag: "Destroyer", values: void};

export type GamePhase = {tag: "WaitingForBoards", values: void} | {tag: "InProgress", values: void} | {tag: "Ended", values: void};


export interface GameRules {
  battleship_len: u32;
  board_size: u32;
  carrier_len: u32;
  cruiser_len: u32;
  destroyer_len: u32;
  submarine_len: u32;
  total_ship_cells: u32;
}


export interface ShotResult {
  is_hit: boolean;
  next_turn: Option<string>;
  sunk_ship: u32;
  winner: Option<string>;
}

export type DataKey = {tag: "Game", values: readonly [u32]} | {tag: "GameHubAddress", values: void} | {tag: "VerifierAddress", values: void} | {tag: "Admin", values: void};

export interface Client {
  /**
   * Construct and simulate a fire transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  fire: ({session_id, shooter, x, y}: {session_id: u32, shooter: string, x: u32, y: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_hub: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_hub: ({new_hub}: {new_hub: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_game: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Game>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_rules transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_rules: (options?: MethodOptions) => Promise<AssembledTransaction<GameRules>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a start_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  start_game: ({session_id, player1, player2, player1_points, player2_points}: {session_id: u32, player1: string, player2: string, player1_points: i128, player2_points: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a commit_board transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  commit_board: ({session_id, player, board_commitment}: {session_id: u32, player: string, board_commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_verifier: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a resolve_shot transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resolve_shot: ({session_id, defender, is_hit, sunk_ship, proof_payload, public_inputs_hash}: {session_id: u32, defender: string, is_hit: boolean, sunk_ship: u32, proof_payload: Buffer, public_inputs_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<ShotResult>>>

  /**
   * Construct and simulate a set_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_verifier: ({new_verifier}: {new_verifier: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a build_public_inputs_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  build_public_inputs_hash: ({session_id, defender, shooter, x, y, is_hit, sunk_ship, board_commitment}: {session_id: u32, defender: string, shooter: string, x: u32, y: u32, is_hit: boolean, sunk_ship: u32, board_commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, game_hub, verifier}: {admin: string, game_hub: string, verifier: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, game_hub, verifier}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAEZmlyZQAAAAQAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAAB3Nob290ZXIAAAAAEwAAAAAAAAABeAAAAAAAAAQAAAAAAAAAAXkAAAAAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAHZ2V0X2h1YgAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAAHc2V0X2h1YgAAAAABAAAAAAAAAAduZXdfaHViAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
        "AAAAAAAAAAAAAAAIZ2V0X2dhbWUAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAQAAA+kAAAfQAAAABEdhbWUAAAAD",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAJZ2V0X3J1bGVzAAAAAAAAAAAAAAEAAAfQAAAACUdhbWVSdWxlcwAAAA==",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAKc3RhcnRfZ2FtZQAAAAAABQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAAdwbGF5ZXIyAAAAABMAAAAAAAAADnBsYXllcjFfcG9pbnRzAAAAAAALAAAAAAAAAA5wbGF5ZXIyX3BvaW50cwAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAMY29tbWl0X2JvYXJkAAAAAwAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAGcGxheWVyAAAAAAATAAAAAAAAABBib2FyZF9jb21taXRtZW50AAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAMZ2V0X3ZlcmlmaWVyAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAMcmVzb2x2ZV9zaG90AAAABgAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAIZGVmZW5kZXIAAAATAAAAAAAAAAZpc19oaXQAAAAAAAEAAAAAAAAACXN1bmtfc2hpcAAAAAAAAAQAAAAAAAAADXByb29mX3BheWxvYWQAAAAAAAAOAAAAAAAAABJwdWJsaWNfaW5wdXRzX2hhc2gAAAAAA+4AAAAgAAAAAQAAA+kAAAfQAAAAClNob3RSZXN1bHQAAAAAAAM=",
        "AAAAAAAAAAAAAAAMc2V0X3ZlcmlmaWVyAAAAAQAAAAAAAAAMbmV3X3ZlcmlmaWVyAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAMAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIZ2FtZV9odWIAAAATAAAAAAAAAAh2ZXJpZmllcgAAABMAAAAA",
        "AAAAAAAAAAAAAAAYYnVpbGRfcHVibGljX2lucHV0c19oYXNoAAAACAAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAIZGVmZW5kZXIAAAATAAAAAAAAAAdzaG9vdGVyAAAAABMAAAAAAAAAAXgAAAAAAAAEAAAAAAAAAAF5AAAAAAAABAAAAAAAAAAGaXNfaGl0AAAAAAABAAAAAAAAAAlzdW5rX3NoaXAAAAAAAAAEAAAAAAAAABBib2FyZF9jb21taXRtZW50AAAD7gAAACAAAAABAAAD7gAAACA=",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAFAAAAAAAAAAMR2FtZU5vdEZvdW5kAAAAAQAAAAAAAAARR2FtZUFscmVhZHlFeGlzdHMAAAAAAAACAAAAAAAAAAlOb3RQbGF5ZXIAAAAAAAADAAAAAAAAABJTZWxmUGxheU5vdEFsbG93ZWQAAAAAAAQAAAAAAAAAEEdhbWVBbHJlYWR5RW5kZWQAAAAFAAAAAAAAAAxJbnZhbGlkUGhhc2UAAAAGAAAAAAAAABVCb2FyZEFscmVhZHlDb21taXR0ZWQAAAAAAAAHAAAAAAAAABFCb2FyZE5vdENvbW1pdHRlZAAAAAAAAAgAAAAAAAAAC05vdFlvdXJUdXJuAAAAAAkAAAAAAAAAEVBlbmRpbmdTaG90RXhpc3RzAAAAAAAACgAAAAAAAAANTm9QZW5kaW5nU2hvdAAAAAAAAAsAAAAAAAAAEUludmFsaWRDb29yZGluYXRlAAAAAAAADAAAAAAAAAATU2hvdEFscmVhZHlSZXNvbHZlZAAAAAANAAAAAAAAAA9JbnZhbGlkRGVmZW5kZXIAAAAADgAAAAAAAAAPSW52YWxpZFNoaXBUeXBlAAAAAA8AAAAAAAAAD0ludmFsaWRTdW5rU2hpcAAAAAAQAAAAAAAAAA9TaGlwQWxyZWFkeVN1bmsAAAAAEQAAAAAAAAAXSW52YWxpZFB1YmxpY0lucHV0c0hhc2gAAAAAEgAAAAAAAAAMSW52YWxpZFByb29mAAAAEwAAAAAAAAALVG9vTWFueUhpdHMAAAAAFA==",
        "AAAAAQAAAAAAAAAAAAAABEdhbWUAAAASAAAAAAAAABNib2FyZF9jb21taXRtZW50X3AxAAAAA+gAAAPuAAAAIAAAAAAAAAATYm9hcmRfY29tbWl0bWVudF9wMgAAAAPoAAAD7gAAACAAAAAAAAAACmhpdHNfb25fcDEAAAAAAAQAAAAAAAAACmhpdHNfb25fcDIAAAAAAAQAAAAAAAAAFHBlbmRpbmdfc2hvdF9zaG9vdGVyAAAD6AAAABMAAAAAAAAADnBlbmRpbmdfc2hvdF94AAAAAAAEAAAAAAAAAA5wZW5kaW5nX3Nob3RfeQAAAAAABAAAAAAAAAAFcGhhc2UAAAAAAAfQAAAACUdhbWVQaGFzZQAAAAAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAA5wbGF5ZXIxX3BvaW50cwAAAAAACwAAAAAAAAAHcGxheWVyMgAAAAATAAAAAAAAAA5wbGF5ZXIyX3BvaW50cwAAAAAACwAAAAAAAAAOc2hvdHNfcDFfdG9fcDIAAAAAAAoAAAAAAAAADnNob3RzX3AyX3RvX3AxAAAAAAAKAAAAAAAAABBzdW5rX3NoaXBzX29uX3AxAAAABAAAAAAAAAAQc3Vua19zaGlwc19vbl9wMgAAAAQAAAAAAAAABHR1cm4AAAPoAAAAEwAAAAAAAAAGd2lubmVyAAAAAAPoAAAAEw==",
        "AAAAAgAAAAAAAAAAAAAACFNoaXBUeXBlAAAABQAAAAAAAAAAAAAAB0NhcnJpZXIAAAAAAAAAAAAAAAAKQmF0dGxlc2hpcAAAAAAAAAAAAAAAAAAHQ3J1aXNlcgAAAAAAAAAAAAAAAAlTdWJtYXJpbmUAAAAAAAAAAAAAAAAAAAlEZXN0cm95ZXIAAAA=",
        "AAAAAgAAAAAAAAAAAAAACUdhbWVQaGFzZQAAAAAAAAMAAAAAAAAAAAAAABBXYWl0aW5nRm9yQm9hcmRzAAAAAAAAAAAAAAAKSW5Qcm9ncmVzcwAAAAAAAAAAAAAAAAAFRW5kZWQAAAA=",
        "AAAAAQAAAAAAAAAAAAAACUdhbWVSdWxlcwAAAAAAAAcAAAAAAAAADmJhdHRsZXNoaXBfbGVuAAAAAAAEAAAAAAAAAApib2FyZF9zaXplAAAAAAAEAAAAAAAAAAtjYXJyaWVyX2xlbgAAAAAEAAAAAAAAAAtjcnVpc2VyX2xlbgAAAAAEAAAAAAAAAA1kZXN0cm95ZXJfbGVuAAAAAAAABAAAAAAAAAANc3VibWFyaW5lX2xlbgAAAAAAAAQAAAAAAAAAEHRvdGFsX3NoaXBfY2VsbHMAAAAE",
        "AAAAAQAAAAAAAAAAAAAAClNob3RSZXN1bHQAAAAAAAQAAAAAAAAABmlzX2hpdAAAAAAAAQAAAAAAAAAJbmV4dF90dXJuAAAAAAAD6AAAABMAAAAAAAAACXN1bmtfc2hpcAAAAAAAAAQAAAAAAAAABndpbm5lcgAAAAAD6AAAABM=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABAAAAAEAAAAAAAAABEdhbWUAAAABAAAABAAAAAAAAAAAAAAADkdhbWVIdWJBZGRyZXNzAAAAAAAAAAAAAAAAAA9WZXJpZmllckFkZHJlc3MAAAAAAAAAAAAAAAAFQWRtaW4AAAA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    fire: this.txFromJSON<Result<void>>,
        get_hub: this.txFromJSON<string>,
        set_hub: this.txFromJSON<null>,
        upgrade: this.txFromJSON<null>,
        get_game: this.txFromJSON<Result<Game>>,
        get_admin: this.txFromJSON<string>,
        get_rules: this.txFromJSON<GameRules>,
        set_admin: this.txFromJSON<null>,
        start_game: this.txFromJSON<Result<void>>,
        commit_board: this.txFromJSON<Result<void>>,
        get_verifier: this.txFromJSON<string>,
        resolve_shot: this.txFromJSON<Result<ShotResult>>,
        set_verifier: this.txFromJSON<null>,
        build_public_inputs_hash: this.txFromJSON<Buffer>
  }
}
