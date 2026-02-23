import type { Game, GameRules, GuessResult, WordleClient } from '@/bindings';
import { createWordleClientWithOptions } from '@/bindings';
import { Address, xdr, authorizeEntry } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { RPC_URL, NETWORK_PASSPHRASE } from '@/utils/constants';
import { DEFAULT_METHOD_OPTIONS, DEFAULT_AUTH_TTL_MINUTES, MULTI_SIG_AUTH_TTL_MINUTES } from '@/utils/constants';
import { calculateValidUntilLedger } from '@/utils/ledgerUtils';
import { injectSignedAuthEntry } from '@/utils/authEntryUtils';
import { signAndSendViaLaunchtube } from '@/utils/transactionHelper';

const WORD_LENGTH = 5;
const MAX_GUESSES = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

interface AssembledTx {
  simulationData?: { result?: { auth?: xdr.SorobanAuthorizationEntry[] } };
  simulate(): Promise<unknown>;
  toXDR(): string;
  needsNonInvokerSigningBy?(): Promise<string[]>;
  signAuthEntries?(opts: { expiration: number }): Promise<void>;
}

/** Letter to contract value: A=0, B=1, ..., Z=25 */
export function lettersToBytes(word: string): Uint8Array {
  const upper = word.toUpperCase().slice(0, WORD_LENGTH).padEnd(WORD_LENGTH, ' ');
  const out = new Uint8Array(WORD_LENGTH);
  for (let i = 0; i < WORD_LENGTH; i++) {
    const c = upper[i]!;
    const idx = ALPHABET.indexOf(c);
    out[i] = idx === -1 ? 0 : idx;
  }
  return out;
}

export function bytesToLetters(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => (b >= 0 && b < 26 ? ALPHABET[b] : '?'))
    .join('');
}

/**
 * Compute Wordle feedback (0=absent, 1=present, 2=correct) for a guess against the secret word.
 * Standard rules: green = exact match; yellow = letter in word but wrong position (each occurrence used once); gray = otherwise.
 */
export function computeFeedback(secretWord: string, guess: string): FeedbackTuple {
  const secret = secretWord.toUpperCase().padEnd(WORD_LENGTH, ' ').slice(0, WORD_LENGTH);
  const g = guess.toUpperCase().padEnd(WORD_LENGTH, ' ').slice(0, WORD_LENGTH);
  const out: FeedbackTuple = [0, 0, 0, 0, 0];
  const used: boolean[] = [false, false, false, false, false];
  // First pass: exact matches (green)
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (g[i] === secret[i]) {
      out[i] = FEEDBACK.CORRECT;
      used[i] = true;
    }
  }
  // Second pass: present (yellow) for remaining letters
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (out[i] === FEEDBACK.CORRECT) continue;
    for (let j = 0; j < WORD_LENGTH; j++) {
      if (!used[j] && secret[j] === g[i]) {
        used[j] = true;
        out[i] = FEEDBACK.PRESENT;
        break;
      }
    }
  }
  return out;
}

const FEEDBACK = { ABSENT: 0, PRESENT: 1, CORRECT: 2 } as const;
export type FeedbackTuple = [number, number, number, number, number];

type Signer = Pick<
  { signTransaction: unknown; signAuthEntry: (xdr: string, opts?: { networkPassphrase?: string; address?: string }) => Promise<{ signedAuthEntry?: string; error?: { message: string } }> },
  'signTransaction' | 'signAuthEntry'
>;

export class WordleService {
  private contractId: string;
  private client: WordleClient | null;

  constructor(contractId: string, client: WordleClient | null = null) {
    this.contractId = contractId;
    this.client = client;
  }

  setClient(client: WordleClient | null): void {
    this.client = client;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async getGame(sessionId: number): Promise<Game | null> {
    if (!this.client) return null;
    try {
      const tx = await this.client.get_game({ session_id: sessionId });
      const assembled = tx as unknown as { simulate: () => Promise<{ result: { isOk: () => boolean; unwrap: () => unknown } }> };
      const simulated = await assembled.simulate();
      if (!simulated.result?.isOk?.()) return null;
      const raw = simulated.result.unwrap();
      if (!raw || typeof raw !== 'object') return null;
      const g = raw as Record<string, unknown>;
      // Contract returns phase as { tag: 'WaitingForWord' } | { tag: 'InProgress' } | { tag: 'Ended' }
      const phaseObj = g.phase as { tag?: string } | string | undefined;
      const phase = typeof phaseObj === 'string' ? phaseObj : phaseObj?.tag ?? 'InProgress';
      // Normalize guesses to string[] (5 letters each) for grid display
      const rawGuesses = Array.isArray(g.guesses) ? g.guesses : [];
      const guesses: string[] = rawGuesses.map((guessRow: unknown) => {
        if (typeof guessRow === 'string') return guessRow.slice(0, WORD_LENGTH).padEnd(WORD_LENGTH);
        if (guessRow instanceof Uint8Array) return bytesToLetters(guessRow).slice(0, WORD_LENGTH).padEnd(WORD_LENGTH);
        if (Array.isArray(guessRow)) return bytesToLetters(new Uint8Array(guessRow as number[])).slice(0, WORD_LENGTH).padEnd(WORD_LENGTH);
        // Buffer or array-like (contract may return Buffer)
        if (guessRow != null && typeof guessRow === 'object' && 'length' in guessRow && typeof (guessRow as { length: number }).length === 'number') {
          const arr = guessRow as ArrayLike<number>;
          return bytesToLetters(new Uint8Array(Array.from(arr))).slice(0, WORD_LENGTH).padEnd(WORD_LENGTH);
        }
        return '     ';
      });
      // Normalize feedbacks to number[][] (0=absent, 1=present, 2=correct) for green/yellow/gray
      const rawFeedbacks = Array.isArray(g.feedbacks) ? g.feedbacks : [];
      const feedbacks: number[][] = rawFeedbacks.map((feedbackRow: unknown) => {
        if (!Array.isArray(feedbackRow)) return [0, 0, 0, 0, 0];
        const row = feedbackRow.slice(0, 5).map((v: unknown) => {
          const n = Number(v);
          return n === 2 ? 2 : n === 1 ? 1 : 0;
        });
        while (row.length < 5) row.push(0);
        return row.slice(0, 5) as [number, number, number, number, number];
      });
      // Normalize pending_guess to string (5 letters) for grid display while waiting for resolve
      let pending_guess: string | null = null;
      const rawPending = g.pending_guess;
      if (rawPending != null) {
        if (typeof rawPending === 'string') pending_guess = rawPending.slice(0, WORD_LENGTH).padEnd(WORD_LENGTH);
        else if (rawPending instanceof Uint8Array) pending_guess = bytesToLetters(rawPending).slice(0, WORD_LENGTH).padEnd(WORD_LENGTH);
        else if (Array.isArray(rawPending)) pending_guess = bytesToLetters(new Uint8Array(rawPending as number[])).slice(0, WORD_LENGTH).padEnd(WORD_LENGTH);
        else if (typeof rawPending === 'object' && 'length' in rawPending) pending_guess = bytesToLetters(new Uint8Array(Array.from(rawPending as ArrayLike<number>))).slice(0, WORD_LENGTH).padEnd(WORD_LENGTH);
      }
      // Normalize word_commitment to 64-char hex so wordCommitmentToBytes() and Game type work (contract may return Uint8Array/Buffer)
      let word_commitment: string | null = null;
      const rawWc = g.word_commitment;
      if (rawWc != null) {
        let bytes: Uint8Array | null = null;
        if (typeof rawWc === 'string' && /^[0-9a-fA-F]+$/.test(rawWc.replace(/^0x/, '')) && rawWc.replace(/^0x/, '').length === 64) {
          const hex = rawWc.replace(/^0x/, '');
          bytes = new Uint8Array(32);
          for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        } else if (rawWc instanceof Uint8Array && rawWc.length === 32) {
          bytes = rawWc;
        } else if (Array.isArray(rawWc) && rawWc.length === 32) {
          bytes = new Uint8Array(rawWc);
        } else if (typeof rawWc === 'object' && 'length' in rawWc && (rawWc as { length: number }).length === 32) {
          bytes = new Uint8Array(Array.from(rawWc as ArrayLike<number>));
        }
        if (bytes && bytes.length === 32) {
          // Use raw bytes as returned by contract so build_public_inputs_hash(..., word_commitment) matches resolve_guess
          word_commitment = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
        }
      }
      return {
        ...g,
        phase: phase as 'WaitingForWord' | 'InProgress' | 'Ended',
        word_setter: typeof g.word_setter === 'string' ? g.word_setter : String(g.word_setter ?? ''),
        guesser: typeof g.guesser === 'string' ? g.guesser : String(g.guesser ?? ''),
        word_commitment,
        guesses,
        feedbacks,
        pending_guess,
      } as Game;
    } catch {
      return null;
    }
  }

  async getRules(): Promise<GameRules> {
    if (!this.client) {
      return {
        word_length: WORD_LENGTH,
        max_guesses: MAX_GUESSES,
        alphabet_size: 26,
      };
    }
    const tx = await this.client.get_rules();
    return (tx as { result: GameRules }).result;
  }

  /**
   * Multi-sig start_game: Step 1 – build tx with Player 2 as source, sign Player 1's auth entry, return signed auth XDR.
   */
  async prepareStartGame(
    sessionId: number,
    player1: string,
    player2: string,
    player1Points: bigint,
    player2Points: bigint,
    player1Signer: Signer
  ): Promise<string> {
    const buildClient = await createWordleClientWithOptions({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: player2,
    });
    if (!buildClient) throw new Error('Wordle contract not configured.');
    const tx = (await (buildClient as unknown as { start_game: (p: object, o?: object) => Promise<AssembledTx> }).start_game(
      {
        session_id: sessionId,
        player1,
        player2,
        player1_points: player1Points,
        player2_points: player2Points,
      },
      DEFAULT_METHOD_OPTIONS
    )) as AssembledTx;
    if (!tx.simulationData?.result?.auth) throw new Error('No auth entries in simulation');
    const authEntries = tx.simulationData.result.auth;
    let player1Entry: xdr.SorobanAuthorizationEntry | null = null;
    for (let i = 0; i < authEntries.length; i++) {
      const entry = authEntries[i];
      if (!entry) continue;
      try {
        if (entry.credentials().switch().name === 'sorobanCredentialsAddress') {
          const addr = Address.fromScAddress(entry.credentials().address().address()).toString();
          if (addr === player1) {
            player1Entry = entry;
            break;
          }
        }
      } catch {
        continue;
      }
    }
    if (!player1Entry || !player1Signer.signAuthEntry) throw new Error('Player 1 auth entry or signer missing');
    const validUntil = await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);
    const signedEntry = await authorizeEntry(
      player1Entry,
      async (preimage) => {
        const res = await player1Signer.signAuthEntry!(preimage.toXDR('base64'), {
          networkPassphrase: NETWORK_PASSPHRASE,
          address: player1,
        });
        if (res?.error) throw new Error(res.error.message);
        return Buffer.from(res!.signedAuthEntry!, 'base64');
      },
      validUntil,
      NETWORK_PASSPHRASE
    );
    return signedEntry.toXDR('base64');
  }

  /** Parse Player 1's signed auth entry (start_game: session_id, player_points). */
  parseAuthEntry(authEntryXdr: string): { sessionId: number; player1: string; player1Points: bigint } {
    const authEntry = xdr.SorobanAuthorizationEntry.fromXDR(authEntryXdr, 'base64');
    const player1 = Address.fromScAddress(authEntry.credentials().address().address()).toString();
    const contractFn = authEntry.rootInvocation().function().contractFn();
    const args = contractFn.args();
    if (args.length < 2) throw new Error('Expected at least 2 args in start_game auth entry');
    const arg0 = args[0];
    const arg1 = args[1];
    if (!arg0 || !arg1) throw new Error('Invalid auth entry args');
    const sessionId = arg0.u32();
    const player1Points = arg1.i128().lo().toBigInt();
    return { sessionId, player1, player1Points };
  }

  /**
   * Multi-sig start_game: Step 2 – rebuild tx with Player 2 as source, inject Player 1's signed auth, sign Player 2's auth, return full tx XDR.
   */
  async importAndSignAuthEntry(
    player1SignedAuthXdr: string,
    player2Address: string,
    player2Points: bigint,
    player2Signer: Signer
  ): Promise<string> {
    const params = this.parseAuthEntry(player1SignedAuthXdr);
    if (player2Address === params.player1) throw new Error('Player 2 must be different from Player 1.');
    const buildClient = await createWordleClientWithOptions({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: player2Address,
    });
    if (!buildClient) throw new Error('Wordle contract not configured.');
    const tx = (await (buildClient as unknown as { start_game: (p: object, o?: object) => Promise<AssembledTx> }).start_game(
      {
        session_id: params.sessionId,
        player1: params.player1,
        player2: player2Address,
        player1_points: params.player1Points,
        player2_points: player2Points,
      },
      DEFAULT_METHOD_OPTIONS
    )) as AssembledTx;
    const validUntil = await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);
    const txWithAuth = await injectSignedAuthEntry(
      tx as unknown as import('@/utils/authEntryUtils').AssembledTxWithAuth,
      player1SignedAuthXdr,
      player2Address,
      player2Signer,
      validUntil
    );
    const signingClient = await createWordleClientWithOptions({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: player2Address,
      signTransaction: player2Signer.signTransaction as (x: string, o?: object) => Promise<{ signedTxXdr: string }>,
      signAuthEntry: player2Signer.signAuthEntry as (x: string, o?: object) => Promise<{ signedAuthEntry: string }>,
    });
    if (!signingClient) throw new Error('Wordle contract not configured.');
    const raw = (txWithAuth as { toXDR?: () => string }).toXDR?.();
    if (!raw) throw new Error('Transaction has no toXDR');
    const player2Tx = (signingClient as { txFromXDR?: (x: string) => AssembledTx }).txFromXDR?.(raw);
    if (!player2Tx) throw new Error('Client has no txFromXDR');
    const needsSigning = await (player2Tx as { needsNonInvokerSigningBy?: () => Promise<string[]> }).needsNonInvokerSigningBy?.();
    if (needsSigning?.includes(player2Address)) {
      await (player2Tx as { signAuthEntries?: (o: { expiration: number }) => Promise<void> }).signAuthEntries?.({ expiration: validUntil });
    }
    return (player2Tx as { toXDR?: () => string }).toXDR?.() ?? raw;
  }

  /**
   * Multi-sig start_game: Step 3 – import full tx XDR, re-simulate, sign envelope and submit.
   */
  async finalizeStartGame(
    fullTxXdr: string,
    signerAddress: string,
    signer: Signer
  ): Promise<void> {
    const client = await createWordleClientWithOptions({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: signerAddress,
      signTransaction: signer.signTransaction as (x: string, o?: object) => Promise<{ signedTxXdr: string }>,
      signAuthEntry: signer.signAuthEntry as (x: string, o?: object) => Promise<{ signedAuthEntry: string }>,
    });
    if (!client) throw new Error('Wordle contract not configured.');
    const tx = (client as { txFromXDR?: (x: string) => AssembledTx }).txFromXDR?.(fullTxXdr);
    if (!tx) throw new Error('Client has no txFromXDR');
    await tx.simulate();
    const validUntil = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    await signAndSendViaLaunchtube(tx as any, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntil);
  }

  /** Start game using multi-sig flow (both signers provided). Call prepareStartGame -> importAndSignAuthEntry -> finalizeStartGame. */
  async startGameMultiSig(
    sessionId: number,
    wordSetter: string,
    guesser: string,
    wordSetterPoints: bigint,
    guesserPoints: bigint,
    player1Signer: Signer,
    player2Signer: Signer
  ): Promise<void> {
    const authXdr = await this.prepareStartGame(sessionId, wordSetter, guesser, wordSetterPoints, guesserPoints, player1Signer);
    const fullXdr = await this.importAndSignAuthEntry(authXdr, guesser, guesserPoints, player2Signer);
    await this.finalizeStartGame(fullXdr, guesser, player2Signer);
  }

  async commitWord(
    sessionId: number,
    player: string,
    wordCommitment: Uint8Array,
    signerOptions?: { publicKey?: string; signTransaction: unknown; signAuthEntry: unknown }
  ): Promise<void> {
    if (!this.client) throw new Error('Wordle contract not configured.');
    const client = this.client as unknown as {
      commit_word: (params: object, options?: { publicKey?: string }) => Promise<{ signAndSend: (opts?: object) => Promise<unknown> }>;
    };
    const tx = await client.commit_word(
      {
        session_id: sessionId,
        player,
        word_commitment: wordCommitment,
      },
      { publicKey: signerOptions?.publicKey ?? player }
    );
    await tx.signAndSend(signerOptions ? { ...signerOptions } : undefined);
  }

  async guess(
    sessionId: number,
    guesser: string,
    guessLetters: Uint8Array,
    signerOptions?: { publicKey?: string; signTransaction: unknown; signAuthEntry: unknown }
  ): Promise<void> {
    if (!this.client) throw new Error('Wordle contract not configured.');
    const client = this.client as unknown as {
      guess: (params: object, options?: { publicKey?: string }) => Promise<{ signAndSend: (opts?: object) => Promise<unknown> }>;
    };
    const tx = await client.guess(
      {
        session_id: sessionId,
        guesser,
        guess_letters: guessLetters,
      },
      { publicKey: signerOptions?.publicKey ?? guesser }
    );
    await tx.signAndSend(signerOptions ? { ...signerOptions } : undefined);
  }

  async resolveGuess(
    sessionId: number,
    wordSetter: string,
    feedback: number[],
    isCorrect: boolean,
    proofPayload: Uint8Array,
    publicInputsHash: Uint8Array,
    signerOptions?: { publicKey?: string; signTransaction: unknown; signAuthEntry: unknown }
  ): Promise<GuessResult> {
    if (!this.client) throw new Error('Wordle contract not configured.');
    const client = this.client as unknown as {
      resolve_guess: (params: object, options?: { publicKey?: string }) => Promise<{ signAndSend: (opts?: object) => Promise<unknown>; result?: { ok?: () => GuessResult } }>;
    };
    const tx = await client.resolve_guess(
      {
        session_id: sessionId,
        word_setter: wordSetter,
        feedback,
        is_correct: isCorrect,
        proof_payload: proofPayload,
        public_inputs_hash: publicInputsHash,
      },
      { publicKey: signerOptions?.publicKey ?? wordSetter }
    );
    await tx.signAndSend(signerOptions ? { ...signerOptions } : undefined);
    const result = tx.result?.ok?.();
    if (result) return result;
    // signAndSend didn't throw so the tx was sent; SDK may not expose result here. Caller will refresh via loadGame().
    return {
      guess_number: 0,
      feedback,
      is_correct: isCorrect,
      winner: isCorrect ? wordSetter : null,
      game_ended: isCorrect,
    };
  }

  /**
   * Build the public inputs hash for resolve_guess (must match contract computation).
   * Use this with the same params you will pass to resolve_guess so the hash is accepted.
   */
  async buildPublicInputsHash(
    sessionId: number,
    wordSetter: string,
    guesser: string,
    guessLetters: Uint8Array,
    feedback: number[],
    isCorrect: boolean,
    wordCommitment: Uint8Array
  ): Promise<Uint8Array> {
    if (!this.client) throw new Error('Wordle contract not configured.');
    const tx = await this.client.build_public_inputs_hash({
      session_id: sessionId,
      word_setter: wordSetter,
      guesser,
      guess_letters: guessLetters,
      feedback,
      is_correct: isCorrect,
      word_commitment: wordCommitment,
    });
    const result = (tx as { result?: Uint8Array }).result;
    if (result) return result;
    throw new Error('build_public_inputs_hash failed');
  }
}

/** Decode word_commitment from game (hex string, base64, Uint8Array, Buffer, or number[]) to 32 bytes */
export function wordCommitmentToBytes(game: { word_commitment?: string | number[] | Uint8Array | ArrayLike<number> | null }): Uint8Array | null {
  const wc = game.word_commitment;
  if (!wc) return null;
  if (typeof wc === 'string') {
    const hex = wc.replace(/^0x/i, '');
    if (hex.length === 64 && /^[0-9a-fA-F]+$/.test(hex)) {
      const arr = new Uint8Array(32);
      for (let i = 0; i < 32; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return arr;
    }
    try {
      const bin = atob(wc.replace(/-/g, '+').replace(/_/g, '/'));
      const arr = new Uint8Array(bin.length).map((_, i) => bin.charCodeAt(i));
      return arr.length === 32 ? arr : null;
    } catch {
      return null;
    }
  }
  if (Array.isArray(wc) && wc.length === 32) return new Uint8Array(wc);
  if (wc instanceof Uint8Array && wc.length === 32) return wc;
  if (typeof wc === 'object' && wc !== null && 'length' in wc && (wc as { length: number }).length === 32) {
    const arr = new Uint8Array(32);
    for (let i = 0; i < 32; i++) arr[i] = Number((wc as ArrayLike<number>)[i]) & 0xff;
    return arr;
  }
  return null;
}
