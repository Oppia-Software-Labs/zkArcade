import { Buffer } from "buffer";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type { u32, i128, Option } from "@stellar/stellar-sdk/contract";
// Named exports to avoid Vite interop issue with "export * from"
export { Address } from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CDHLHNDAFDCDCXL2HEYNINXG5VZ76HKRJGAKZFS4OWQQTJ6BCTPWRMOY",
  }
} as const


/**
 * Result of resolving a guess (returned to frontend)
 */
export interface GuessResult {
  /**
 * Feedback for each letter (0=absent, 1=present, 2=correct)
 */
feedback: Array<u32>;
  /**
 * Whether the game has ended
 */
game_ended: boolean;
  /**
 * Which guess this was (1-6)
 */
guess_number: u32;
  /**
 * Whether the guess was correct
 */
is_correct: boolean;
  /**
 * Winner address if game ended
 */
winner: Option<string>;
}

/**
 * Storage keys for contract data
 */
export type DataKey = {tag: "Game", values: readonly [u32]} | {tag: "GameHubAddress", values: void} | {tag: "VerifierAddress", values: void} | {tag: "Admin", values: void};


/**
 * Game aggregate - core domain entity
 */
export interface Game {
  feedbacks: Array<Array<u32>>;
  guess_count: u32;
  guesser: string;
  guesser_points: i128;
  guesses: Array<Buffer>;
  pending_guess: Option<Buffer>;
  phase: GamePhase;
  winner: Option<string>;
  word_commitment: Option<Buffer>;
  word_setter: string;
  word_setter_points: i128;
}

/**
 * Game lifecycle phases
 */
export type GamePhase = {tag: "WaitingForWord", values: void} | {tag: "InProgress", values: void} | {tag: "Ended", values: void};


/**
 * Game rules (immutable configuration)
 */
export interface GameRules {
  alphabet_size: u32;
  max_guesses: u32;
  word_length: u32;
}

/**
 * Domain-specific errors for Wordle game logic
 */
export const DomainError = {
  1: {message:"GameNotFound"},
  2: {message:"GameAlreadyExists"},
  3: {message:"GameAlreadyEnded"},
  4: {message:"InvalidPhase"},
  5: {message:"NotPlayer"},
  6: {message:"NotWordSetter"},
  7: {message:"NotGuesser"},
  8: {message:"SelfPlayNotAllowed"},
  9: {message:"WordAlreadyCommitted"},
  10: {message:"WordNotCommitted"},
  11: {message:"InvalidLetterValue"},
  12: {message:"PendingGuessExists"},
  13: {message:"NoPendingGuess"},
  14: {message:"MaxGuessesReached"},
  15: {message:"InvalidFeedbackLength"},
  16: {message:"InvalidFeedbackValue"},
  17: {message:"InvalidPublicInputsHash"},
  18: {message:"InvalidProof"}
}

export interface Client {
  /**
   * Construct and simulate a guess transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Guesser submits a guess
   */
  guess: ({session_id, guesser, guess_letters}: {session_id: u32, guesser: string, guess_letters: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
   * Get current game state
   */
  get_game: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Game>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_rules transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get game rules
   */
  get_rules: (options?: MethodOptions) => Promise<AssembledTransaction<GameRules>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a start_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Start a new game between two players
   */
  start_game: ({session_id, player1, player2, player1_points, player2_points}: {session_id: u32, player1: string, player2: string, player1_points: i128, player2_points: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a commit_word transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Word setter commits their secret word
   */
  commit_word: ({session_id, player, word_commitment}: {session_id: u32, player: string, word_commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_verifier: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_verifier: ({new_verifier}: {new_verifier: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a resolve_guess transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Word setter resolves a guess with ZK proof
   */
  resolve_guess: ({session_id, word_setter, feedback, is_correct, proof_payload, public_inputs_hash}: {session_id: u32, word_setter: string, feedback: Array<u32>, is_correct: boolean, proof_payload: Buffer, public_inputs_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<GuessResult>>>

  /**
   * Construct and simulate a build_public_inputs_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Build public inputs hash (utility for frontend)
   */
  build_public_inputs_hash: ({session_id, word_setter, guesser, guess_letters, feedback, is_correct, word_commitment}: {session_id: u32, word_setter: string, guesser: string, guess_letters: Buffer, feedback: Array<u32>, is_correct: boolean, word_commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

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
      new ContractSpec([ "AAAAAQAAADJSZXN1bHQgb2YgcmVzb2x2aW5nIGEgZ3Vlc3MgKHJldHVybmVkIHRvIGZyb250ZW5kKQAAAAAAAAAAAAtHdWVzc1Jlc3VsdAAAAAAFAAAAOUZlZWRiYWNrIGZvciBlYWNoIGxldHRlciAoMD1hYnNlbnQsIDE9cHJlc2VudCwgMj1jb3JyZWN0KQAAAAAAAAhmZWVkYmFjawAAA+oAAAAEAAAAGldoZXRoZXIgdGhlIGdhbWUgaGFzIGVuZGVkAAAAAAAKZ2FtZV9lbmRlZAAAAAAAAQAAABpXaGljaCBndWVzcyB0aGlzIHdhcyAoMS02KQAAAAAADGd1ZXNzX251bWJlcgAAAAQAAAAdV2hldGhlciB0aGUgZ3Vlc3Mgd2FzIGNvcnJlY3QAAAAAAAAKaXNfY29ycmVjdAAAAAAAAQAAABxXaW5uZXIgYWRkcmVzcyBpZiBnYW1lIGVuZGVkAAAABndpbm5lcgAAAAAD6AAAABM=",
        "AAAAAgAAAB5TdG9yYWdlIGtleXMgZm9yIGNvbnRyYWN0IGRhdGEAAAAAAAAAAAAHRGF0YUtleQAAAAAEAAAAAQAAABhHYW1lIHN0YXRlIGJ5IHNlc3Npb24gSUQAAAAER2FtZQAAAAEAAAAEAAAAAAAAABlHYW1lIEh1YiBjb250cmFjdCBhZGRyZXNzAAAAAAAADkdhbWVIdWJBZGRyZXNzAAAAAAAAAAAAIVZlcmlmaWVyIGFkYXB0ZXIgY29udHJhY3QgYWRkcmVzcwAAAAAAAA9WZXJpZmllckFkZHJlc3MAAAAAAAAAAA1BZG1pbiBhZGRyZXNzAAAAAAAABUFkbWluAAAA",
        "AAAAAAAAABdHdWVzc2VyIHN1Ym1pdHMgYSBndWVzcwAAAAAFZ3Vlc3MAAAAAAAADAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAdndWVzc2VyAAAAABMAAAAAAAAADWd1ZXNzX2xldHRlcnMAAAAAAAPuAAAABQAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAHZ2V0X2h1YgAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAAHc2V0X2h1YgAAAAABAAAAAAAAAAduZXdfaHViAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
        "AAAAAAAAABZHZXQgY3VycmVudCBnYW1lIHN0YXRlAAAAAAAIZ2V0X2dhbWUAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAQAAA+kAAAfQAAAABEdhbWUAAAAD",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAA5HZXQgZ2FtZSBydWxlcwAAAAAACWdldF9ydWxlcwAAAAAAAAAAAAABAAAH0AAAAAlHYW1lUnVsZXMAAAA=",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAACRTdGFydCBhIG5ldyBnYW1lIGJldHdlZW4gdHdvIHBsYXllcnMAAAAKc3RhcnRfZ2FtZQAAAAAABQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAAdwbGF5ZXIyAAAAABMAAAAAAAAADnBsYXllcjFfcG9pbnRzAAAAAAALAAAAAAAAAA5wbGF5ZXIyX3BvaW50cwAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAACVXb3JkIHNldHRlciBjb21taXRzIHRoZWlyIHNlY3JldCB3b3JkAAAAAAAAC2NvbW1pdF93b3JkAAAAAAMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAABnBsYXllcgAAAAAAEwAAAAAAAAAPd29yZF9jb21taXRtZW50AAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMZ2V0X3ZlcmlmaWVyAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAMc2V0X3ZlcmlmaWVyAAAAAQAAAAAAAAAMbmV3X3ZlcmlmaWVyAAAAEwAAAAA=",
        "AAAAAAAAAEBJbml0aWFsaXplIGNvbnRyYWN0IHdpdGggYWRtaW4sIGdhbWUgaHViLCBhbmQgdmVyaWZpZXIgYWRkcmVzc2VzAAAADV9fY29uc3RydWN0b3IAAAAAAAADAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACGdhbWVfaHViAAAAEwAAAAAAAAAIdmVyaWZpZXIAAAATAAAAAA==",
        "AAAAAAAAACpXb3JkIHNldHRlciByZXNvbHZlcyBhIGd1ZXNzIHdpdGggWksgcHJvb2YAAAAAAA1yZXNvbHZlX2d1ZXNzAAAAAAAABgAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAALd29yZF9zZXR0ZXIAAAAAEwAAAAAAAAAIZmVlZGJhY2sAAAPqAAAABAAAAAAAAAAKaXNfY29ycmVjdAAAAAAAAQAAAAAAAAANcHJvb2ZfcGF5bG9hZAAAAAAAAA4AAAAAAAAAEnB1YmxpY19pbnB1dHNfaGFzaAAAAAAD7gAAACAAAAABAAAD6QAAB9AAAAALR3Vlc3NSZXN1bHQAAAAAAw==",
        "AAAAAAAAAC9CdWlsZCBwdWJsaWMgaW5wdXRzIGhhc2ggKHV0aWxpdHkgZm9yIGZyb250ZW5kKQAAAAAYYnVpbGRfcHVibGljX2lucHV0c19oYXNoAAAABwAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAALd29yZF9zZXR0ZXIAAAAAEwAAAAAAAAAHZ3Vlc3NlcgAAAAATAAAAAAAAAA1ndWVzc19sZXR0ZXJzAAAAAAAD7gAAAAUAAAAAAAAACGZlZWRiYWNrAAAD6gAAAAQAAAAAAAAACmlzX2NvcnJlY3QAAAAAAAEAAAAAAAAAD3dvcmRfY29tbWl0bWVudAAAAAPuAAAAIAAAAAEAAAPuAAAAIA==",
        "AAAAAQAAACNHYW1lIGFnZ3JlZ2F0ZSAtIGNvcmUgZG9tYWluIGVudGl0eQAAAAAAAAAABEdhbWUAAAALAAAAAAAAAAlmZWVkYmFja3MAAAAAAAPqAAAD6gAAAAQAAAAAAAAAC2d1ZXNzX2NvdW50AAAAAAQAAAAAAAAAB2d1ZXNzZXIAAAAAEwAAAAAAAAAOZ3Vlc3Nlcl9wb2ludHMAAAAAAAsAAAAAAAAAB2d1ZXNzZXMAAAAD6gAAA+4AAAAFAAAAAAAAAA1wZW5kaW5nX2d1ZXNzAAAAAAAD6AAAA+4AAAAFAAAAAAAAAAVwaGFzZQAAAAAAB9AAAAAJR2FtZVBoYXNlAAAAAAAAAAAAAAZ3aW5uZXIAAAAAA+gAAAATAAAAAAAAAA93b3JkX2NvbW1pdG1lbnQAAAAD6AAAA+4AAAAgAAAAAAAAAAt3b3JkX3NldHRlcgAAAAATAAAAAAAAABJ3b3JkX3NldHRlcl9wb2ludHMAAAAAAAs=",
        "AAAAAgAAABVHYW1lIGxpZmVjeWNsZSBwaGFzZXMAAAAAAAAAAAAACUdhbWVQaGFzZQAAAAAAAAMAAAAAAAAALFdhaXRpbmcgZm9yIHdvcmQgc2V0dGVyIHRvIGNvbW1pdCB0aGVpciB3b3JkAAAADldhaXRpbmdGb3JXb3JkAAAAAAAAAAAAJkdhbWUgaW4gcHJvZ3Jlc3MsIHBsYXllcnMgdGFraW5nIHR1cm5zAAAAAAAKSW5Qcm9ncmVzcwAAAAAAAAAAAA5HYW1lIGhhcyBlbmRlZAAAAAAABUVuZGVkAAAA",
        "AAAAAQAAACRHYW1lIHJ1bGVzIChpbW11dGFibGUgY29uZmlndXJhdGlvbikAAAAAAAAACUdhbWVSdWxlcwAAAAAAAAMAAAAAAAAADWFscGhhYmV0X3NpemUAAAAAAAAEAAAAAAAAAAttYXhfZ3Vlc3NlcwAAAAAEAAAAAAAAAAt3b3JkX2xlbmd0aAAAAAAE",
        "AAAABAAAACxEb21haW4tc3BlY2lmaWMgZXJyb3JzIGZvciBXb3JkbGUgZ2FtZSBsb2dpYwAAAAAAAAALRG9tYWluRXJyb3IAAAAAEgAAAAAAAAAMR2FtZU5vdEZvdW5kAAAAAQAAAAAAAAARR2FtZUFscmVhZHlFeGlzdHMAAAAAAAACAAAAAAAAABBHYW1lQWxyZWFkeUVuZGVkAAAAAwAAAAAAAAAMSW52YWxpZFBoYXNlAAAABAAAAAAAAAAJTm90UGxheWVyAAAAAAAABQAAAAAAAAANTm90V29yZFNldHRlcgAAAAAAAAYAAAAAAAAACk5vdEd1ZXNzZXIAAAAAAAcAAAAAAAAAElNlbGZQbGF5Tm90QWxsb3dlZAAAAAAACAAAAAAAAAAUV29yZEFscmVhZHlDb21taXR0ZWQAAAAJAAAAAAAAABBXb3JkTm90Q29tbWl0dGVkAAAACgAAAAAAAAASSW52YWxpZExldHRlclZhbHVlAAAAAAALAAAAAAAAABJQZW5kaW5nR3Vlc3NFeGlzdHMAAAAAAAwAAAAAAAAADk5vUGVuZGluZ0d1ZXNzAAAAAAANAAAAAAAAABFNYXhHdWVzc2VzUmVhY2hlZAAAAAAAAA4AAAAAAAAAFUludmFsaWRGZWVkYmFja0xlbmd0aAAAAAAAAA8AAAAAAAAAFEludmFsaWRGZWVkYmFja1ZhbHVlAAAAEAAAAAAAAAAXSW52YWxpZFB1YmxpY0lucHV0c0hhc2gAAAAAEQAAAAAAAAAMSW52YWxpZFByb29mAAAAEg==" ]),
      options
    )
  }
  public readonly fromJSON = {
    guess: this.txFromJSON<Result<void>>,
        get_hub: this.txFromJSON<string>,
        set_hub: this.txFromJSON<null>,
        upgrade: this.txFromJSON<null>,
        get_game: this.txFromJSON<Result<Game>>,
        get_admin: this.txFromJSON<string>,
        get_rules: this.txFromJSON<GameRules>,
        set_admin: this.txFromJSON<null>,
        start_game: this.txFromJSON<Result<void>>,
        commit_word: this.txFromJSON<Result<void>>,
        get_verifier: this.txFromJSON<string>,
        set_verifier: this.txFromJSON<null>,
        resolve_guess: this.txFromJSON<Result<GuessResult>>,
        build_public_inputs_hash: this.txFromJSON<Buffer>
  }
}

