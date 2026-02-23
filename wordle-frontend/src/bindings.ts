/**
 * Wordle contract types and client loader.
 *
 * After deploying: bun run build wordle && bun run bindings wordle
 * Client is loaded from wordle-contract alias (bindings/wordle).
 */

export type GamePhase = 'WaitingForWord' | 'InProgress' | 'Ended';

export interface GameRules {
  word_length: number;
  max_guesses: number;
  alphabet_size: number;
}

export interface Game {
  word_setter: string;
  guesser: string;
  word_setter_points: string;
  guesser_points: string;
  phase: GamePhase;
  word_commitment: string | null;
  guess_count: number;
  pending_guess: string | null;
  winner: string | null;
  guesses: string[];
  feedbacks: number[][];
}

export interface GuessResult {
  guess_number: number;
  feedback: number[];
  is_correct: boolean;
  winner: string | null;
  game_ended: boolean;
}

export const FEEDBACK = {
  ABSENT: 0,
  PRESENT: 1,
  CORRECT: 2,
} as const;

export interface WordleClient {
  get_game(params: { session_id: number }): Promise<{ result: { ok: () => Game } }>;
  get_rules(): Promise<{ result: GameRules }>;
  start_game(params: {
    session_id: number;
    player1: string;
    player2: string;
    player1_points: bigint;
    player2_points: bigint;
  }): Promise<{ signAndSend: (opts?: object) => Promise<unknown> }>;
  commit_word(params: {
    session_id: number;
    player: string;
    word_commitment: Uint8Array;
  }): Promise<{ signAndSend: () => Promise<unknown> }>;
  guess(params: {
    session_id: number;
    guesser: string;
    guess_letters: Uint8Array;
  }): Promise<{ signAndSend: () => Promise<unknown> }>;
  resolve_guess(params: {
    session_id: number;
    word_setter: string;
    feedback: number[];
    is_correct: boolean;
    proof_payload: Uint8Array;
    public_inputs_hash: Uint8Array;
  }): Promise<{ result: { ok: () => GuessResult } }>;
  build_public_inputs_hash(params: {
    session_id: number;
    word_setter: string;
    guesser: string;
    guess_letters: Uint8Array;
    feedback: number[];
    is_correct: boolean;
    word_commitment: Uint8Array;
  }): Promise<{ result: Uint8Array }>;
}

export interface WordleClientOptions {
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
  publicKey?: string;
  signTransaction?: (xdr: string, opts?: object) => Promise<{ signedTxXdr: string; signerAddress?: string; error?: { message: string } }>;
  signAuthEntry?: (xdr: string, opts?: object) => Promise<{ signedAuthEntry: string; signerAddress?: string; error?: { message: string } }>;
}

export async function createWordleClient(
  contractId: string,
  networkPassphrase: string,
  rpcUrl: string
): Promise<WordleClient | null> {
  return createWordleClientWithOptions({ contractId, networkPassphrase, rpcUrl });
}

/** Create a client with optional publicKey (for multi-sig start_game build step). */
export async function createWordleClientWithOptions(
  opts: WordleClientOptions
): Promise<WordleClient | null> {
  if (!opts.contractId) return null;
  try {
    const mod = (await import(/* @vite-ignore */ 'wordle-contract')) as unknown as {
      Client?: new (opts: WordleClientOptions) => WordleClient;
    };
    const Client = mod.Client;
    if (!Client) return null;
    return new Client(opts);
  } catch {
    return null;
  }
}
