import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { sileo } from 'sileo';
import {
  WordleService,
  lettersToBytes,
  bytesToLetters,
  computeFeedback,
  wordCommitmentToBytes,
} from './wordleService';
import { generateResolveGuessProof, getWordCommitmentBytesFromWasm, getWordCommitmentHiLoFromWasm } from './proofService';
import { useWallet } from '@/hooks/useWallet';
import { devWalletService } from '@/services/devWalletService';
import { isDevSignerAvailable } from '@/utils/devSigner';
import { config } from '@/config';
import { FEEDBACK, createWordleClient } from '@/bindings';
import { NETWORK_PASSPHRASE, RPC_URL } from '@/utils/constants';

const WORD_LENGTH = 5;
const MAX_GUESSES = 6;

type FeedbackValue = 0 | 1 | 2;

interface CellProps {
  letter: string;
  feedback?: FeedbackValue;
  isCurrent?: boolean;
  isPending?: boolean;
}

function Cell({ letter, feedback, isCurrent, isPending }: CellProps) {
  const bg =
    feedback === FEEDBACK.CORRECT
      ? 'bg-wordle-correct'
      : feedback === FEEDBACK.PRESENT
        ? 'bg-wordle-present'
        : feedback === FEEDBACK.ABSENT
          ? 'bg-wordle-absent'
          : isPending
            ? 'bg-wordle-absent/80 border border-wordle-border'
            : isCurrent
              ? 'bg-wordle-empty border-2 border-wordle-border'
              : 'bg-wordle-empty border border-wordle-border';
  return (
    <div
      className={`flex h-12 w-12 items-center justify-center rounded text-xl font-bold uppercase text-white transition-colors sm:h-14 sm:w-14 ${bg}`}
      title={isPending ? 'Waiting for word setter to verify' : undefined}
    >
      {letter}
    </div>
  );
}

interface WordleGameProps {
  userAddress: string;
  player1Address?: string;
  player2Address?: string;
}

export function WordleGame({ userAddress, player1Address, player2Address }: WordleGameProps) {
  const { getContractSigner } = useWallet();
  const [client, setClient] = useState<Awaited<ReturnType<typeof createWordleClient>>>(null);
  const [sessionId] = useState(() =>
    typeof crypto !== 'undefined' && crypto.getRandomValues
      ? crypto.getRandomValues(new Uint32Array(1))[0]! || 1
      : Math.floor(Math.random() * 0xffffffff) || 1
  );
  const [game, setGame] = useState<Awaited<ReturnType<WordleService['getGame']>>>(null);
  const [currentGuess, setCurrentGuess] = useState('');
  const [loading, setLoading] = useState(false);
  const [secretWordForResolve, setSecretWordForResolve] = useState('');
  const [resolveLoading, setResolveLoading] = useState(false);
  const [resolvePhase, setResolvePhase] = useState<'idle' | 'proving' | 'submitting'>('idle');
  const [startGameLoading, setStartGameLoading] = useState(false);
  const [commitWordLoading, setCommitWordLoading] = useState(false);
  const [secretWordCommit, setSecretWordCommit] = useState('');
  const [commitSalt, setCommitSalt] = useState('1');
  const [resolveSalt, setResolveSalt] = useState('1');
  const guessInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (game?.pending_guess && commitSalt) setResolveSalt(commitSalt);
  }, [game?.pending_guess, commitSalt]);

  useEffect(() => {
    createWordleClient(config.wordleContractId, NETWORK_PASSPHRASE, RPC_URL).then(setClient);
  }, []);

  const wordleService = useMemo(
    () => new WordleService(config.wordleContractId, client),
    [client]
  );

  const loadGame = useCallback(
    async (retries = 0, silent = false) => {
      if (!wordleService.isConfigured()) return;
      if (!silent) setLoading(true);
      try {
        const g = await wordleService.getGame(sessionId);
        setGame((prev) => (g !== null ? g : prev));
        if (g === null && retries < 2) {
          await new Promise((r) => setTimeout(r, 1500));
          return loadGame(retries + 1, silent);
        }
      } catch (e) {
        sileo.error({
          title: 'Failed to load game',
          description: e instanceof Error ? e.message : 'Failed to load game',
        });
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [sessionId, wordleService]
  );

  useEffect(() => {
    loadGame();
    const interval = setInterval(() => loadGame(0, true), 5000);
    return () => clearInterval(interval);
  }, [loadGame]);

  const isWordSetter = game && game.word_setter === userAddress;
  const isGuesser = game && game.guesser === userAddress;
  const canSubmitGuess =
    game?.phase === 'InProgress' &&
    isGuesser &&
    currentGuess.length === WORD_LENGTH &&
    !game.pending_guess &&
    game.guess_count < MAX_GUESSES;

  useEffect(() => {
    if (isGuesser && game?.phase === 'InProgress' && !game?.pending_guess) {
      guessInputRef.current?.focus();
    }
  }, [isGuesser, game?.phase, game?.pending_guess]);

  const handleGuessInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, WORD_LENGTH);
    setCurrentGuess(v);
  };

  const handleGuessKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (canSubmitGuess) submitGuess();
    }
  };

  async function submitGuess() {
    if (!canSubmitGuess || !wordleService.isConfigured()) return;
    setLoading(true);
    try {
      const signer = getContractSigner();
      const letters = lettersToBytes(currentGuess);
      await wordleService.guess(sessionId, userAddress, letters, { ...signer, publicKey: userAddress });
      setCurrentGuess('');
      sileo.success({ title: 'Guess sent', description: 'Waiting for word setter to resolve.' });
      await loadGame(0, true);
    } catch (e) {
      sileo.error({
        title: 'Guess failed',
        description: e instanceof Error ? e.message : 'Guess failed',
      });
    } finally {
      setLoading(false);
    }
  }

  const pendingGuessLetters =
    game?.pending_guess != null
      ? typeof game.pending_guess === 'string'
        ? game.pending_guess.slice(0, WORD_LENGTH).toUpperCase()
        : bytesToLetters(new Uint8Array((game.pending_guess as number[]).slice(0, WORD_LENGTH)))
      : '';
  const pendingGuessBytes =
    game?.pending_guess != null
      ? typeof game.pending_guess === 'string'
        ? lettersToBytes(game.pending_guess)
        : new Uint8Array((game.pending_guess as number[]).slice(0, WORD_LENGTH))
      : null;
  const computedFeedback =
    secretWordForResolve.length === WORD_LENGTH && pendingGuessLetters.length === WORD_LENGTH
      ? computeFeedback(secretWordForResolve, pendingGuessLetters)
      : null;
  const isCorrectResolve = computedFeedback?.every((f) => f === FEEDBACK.CORRECT) ?? false;

  async function handleStartGame() {
    if (!player1Address || !player2Address || !wordleService.isConfigured()) return;
    if (!isDevSignerAvailable()) {
      sileo.warning({
        title: 'Configuration required',
        description: 'Set VITE_DEV_PLAYER1_SECRET and VITE_DEV_PLAYER2_SECRET to start a game (bun run setup).',
      });
      return;
    }
    setStartGameLoading(true);
    try {
      const currentPlayer = userAddress === player1Address ? 1 : userAddress === player2Address ? 2 : null;
      let p1Signer: ReturnType<typeof devWalletService.getSigner> | null = null;
      let p2Signer: ReturnType<typeof devWalletService.getSigner> | null = null;
      try {
        await devWalletService.initPlayer(1);
        p1Signer = devWalletService.getSigner();
        await devWalletService.initPlayer(2);
        p2Signer = devWalletService.getSigner();
      } finally {
        if (currentPlayer) await devWalletService.initPlayer(currentPlayer);
      }
      if (!p1Signer || !p2Signer) throw new Error('Could not get signers');
      await wordleService.startGameMultiSig(
        sessionId,
        player1Address,
        player2Address,
        1n,
        1n,
        p1Signer,
        p2Signer
      );
      sileo.success({
        title: 'Game created',
        description: 'If you are the word setter (Player 1), enter your word below and click «Commit word».',
      });
      setGame({
        word_setter: player1Address,
        guesser: player2Address,
        word_setter_points: '1',
        guesser_points: '1',
        phase: 'WaitingForWord',
        word_commitment: null,
        guess_count: 0,
        pending_guess: null,
        winner: null,
        guesses: [],
        feedbacks: [],
      });
      await loadGame();
    } catch (e) {
      sileo.error({
        title: 'Failed to start game',
        description: e instanceof Error ? e.message : 'Failed to start game',
      });
    } finally {
      setStartGameLoading(false);
    }
  }

  async function handleCommitWord() {
    if (
      !wordleService.isConfigured() ||
      !game ||
      game.phase !== 'WaitingForWord' ||
      !isWordSetter ||
      secretWordCommit.length !== WORD_LENGTH
    )
      return;
    setCommitWordLoading(true);
    try {
      const signer = getContractSigner();
      const wordArr = Array.from(lettersToBytes(secretWordCommit));
      const commitment = await getWordCommitmentBytesFromWasm(wordArr, commitSalt?.trim() || '1');
      await wordleService.commitWord(sessionId, userAddress, commitment, { ...signer, publicKey: userAddress });
      sileo.success({ title: 'Word committed', description: 'Game is in progress.' });
      setSecretWordCommit('');
      await loadGame();
    } catch (e) {
      sileo.error({
        title: 'Failed to commit word',
        description: e instanceof Error ? e.message : 'Failed to commit word',
      });
    } finally {
      setCommitWordLoading(false);
    }
  }

  const TWO_128 = BigInt('340282366920938463463374607431768211456');

  function bytes32ToHiLo(bytes: Uint8Array): { hi: string; lo: string } {
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const hi = BigInt('0x' + hex.slice(0, 32)).toString();
    const lo = BigInt('0x' + hex.slice(32, 64)).toString();
    return { hi, lo };
  }

  function hiLoToBytes32(hi: string, lo: string): Uint8Array {
    const n = BigInt(hi) * TWO_128 + BigInt(lo);
    const hex = n.toString(16).padStart(64, '0').slice(-64);
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  /** Build circuit input for resolve_guess. Uses word_commit WASM for commitment hi/lo so they match the circuit's Poseidon. */
  async function buildResolveInput(): Promise<Record<string, unknown> | null> {
    if (
      !game ||
      !pendingGuessBytes ||
      !computedFeedback ||
      secretWordForResolve.length !== WORD_LENGTH ||
      !wordleService.isConfigured()
    )
      return null;
    const wordArr = Array.from(lettersToBytes(secretWordForResolve));
    const guessArr = Array.from(pendingGuessBytes);
    const { hi: wcHi, lo: wcLo } = await getWordCommitmentHiLoFromWasm(
      wordArr,
      resolveSalt?.trim() || '1'
    );
    const wordCommitmentBytes = hiLoToBytes32(wcHi, wcLo);
    const publicInputsHash = await wordleService.buildPublicInputsHash(
      sessionId,
      game.word_setter,
      game.guesser,
      pendingGuessBytes,
      [...computedFeedback],
      isCorrectResolve,
      wordCommitmentBytes
    );
    const { hi: hashHi, lo: hashLo } = bytes32ToHiLo(publicInputsHash);
    return {
      word: wordArr,
      salt: resolveSalt || '1',
      guess: guessArr,
      feedback: [...computedFeedback],
      is_correct: isCorrectResolve ? 1 : 0,
      word_commitment_hi: wcHi,
      word_commitment_lo: wcLo,
      public_inputs_hash_hi: hashHi,
      public_inputs_hash_lo: hashLo,
    };
  }

  async function resolvePendingGuess() {
    if (
      !game ||
      !game.pending_guess ||
      !isWordSetter ||
      !wordleService.isConfigured() ||
      secretWordForResolve.length !== WORD_LENGTH ||
      !computedFeedback
    )
      return;
    setResolveLoading(true);
    setResolvePhase('idle');
    try {
      const freshGame = await wordleService.getGame(sessionId);
      const gameToUse = freshGame ?? game;
      setGame((prev) => (freshGame !== null ? freshGame : prev));
      const wordCommitment = wordCommitmentToBytes(gameToUse);
      if (!wordCommitment || wordCommitment.length !== 32) {
        sileo.error({ title: 'Error', description: 'Missing or invalid word commitment on game.' });
        setResolveLoading(false);
        return;
      }
      const saltVal = resolveSalt?.trim() || '1';
      const wordArr = Array.from(lettersToBytes(secretWordForResolve));
      const recomputed = await getWordCommitmentBytesFromWasm(wordArr, saltVal);
      const matchForward = recomputed.length === 32 && recomputed.every((b, i) => b === wordCommitment[i]);
      if (!matchForward) {
        const reversed = new Uint8Array(wordCommitment);
        reversed.reverse();
        const matchReversed = recomputed.length === 32 && recomputed.every((b, i) => b === reversed[i]);
        if (!matchReversed) {
          console.warn('[Wordle resolve] Commitment mismatch. Salt used:', String(resolveSalt?.trim() || '1'));
          sileo.error({
            title: 'Commitment mismatch',
            description:
              'Secret word or salt does not match what you used when committing. Use exactly the same word and salt (e.g. 1) as when you did "Commit word".',
          });
          setResolveLoading(false);
          return;
        }
      }
      const input = await buildResolveInput();
      if (!input) {
        sileo.error({ title: 'Error', description: 'Could not build proof input.' });
        return;
      }
      setResolvePhase('proving');
      const proofPayload = await generateResolveGuessProof({
        word: input.word as number[],
        salt: String(input.salt),
        guess: input.guess as number[],
        feedback: input.feedback as number[],
        is_correct: Number(input.is_correct),
        word_commitment_hi: String(input.word_commitment_hi),
        word_commitment_lo: String(input.word_commitment_lo),
        public_inputs_hash_hi: String(input.public_inputs_hash_hi),
        public_inputs_hash_lo: String(input.public_inputs_hash_lo),
      });
      const gameWordCommitment = wordCommitmentToBytes(gameToUse);
      if (!gameWordCommitment || gameWordCommitment.length !== 32) {
        sileo.error({ title: 'Error', description: 'Missing or invalid word commitment on game.' });
        setResolveLoading(false);
        return;
      }
      const publicInputsHash = await wordleService.buildPublicInputsHash(
        sessionId,
        gameToUse.word_setter,
        gameToUse.guesser,
        pendingGuessBytes!,
        [...computedFeedback],
        isCorrectResolve,
        gameWordCommitment
      );
      setResolvePhase('submitting');
      const signer = getContractSigner();
      await wordleService.resolveGuess(
        sessionId,
        gameToUse.word_setter,
        [...computedFeedback],
        isCorrectResolve,
        proofPayload,
        publicInputsHash,
        { ...signer, publicKey: gameToUse.word_setter }
      );
      sileo.success({ title: 'Guess resolved' });
      setSecretWordForResolve('');
      await loadGame();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Resolve failed';
      sileo.error({
        title: 'Failed to resolve guess',
        description: /assert\s*failed/i.test(msg)
          ? 'Proof failed: word or salt does not match what you used when committing. Use exactly the same values.'
          : msg,
      });
    } finally {
      setResolveLoading(false);
      setResolvePhase('idle');
    }
  }

  // Build grid: resolved guesses + optional pending guess row + current input row + empty.
  const rows: { letters: string; feedback?: FeedbackValue[]; isPending?: boolean }[] = [];
  const guessCount = game?.guesses?.length ?? 0;
  const pendingLetters = game?.pending_guess
    ? typeof game.pending_guess === 'string'
      ? game.pending_guess.slice(0, WORD_LENGTH).padEnd(WORD_LENGTH).toUpperCase()
      : ''
    : '';
  const hasPending = !!pendingLetters.trim();
  for (let r = 0; r < MAX_GUESSES; r++) {
    if (game && r < guessCount) {
      const raw = game.guesses[r];
      const letters =
        typeof raw === 'string'
          ? raw.slice(0, WORD_LENGTH).padEnd(WORD_LENGTH)
          : Array.isArray(raw)
            ? bytesToLetters(new Uint8Array(raw as number[])).padEnd(WORD_LENGTH)
            : ''.padEnd(WORD_LENGTH);
      const feedbackRow = game.feedbacks?.[r];
      const feedback: FeedbackValue[] | undefined =
        Array.isArray(feedbackRow) && feedbackRow.length >= 5
          ? (feedbackRow.slice(0, 5).map((v) => (v === 2 ? 2 : v === 1 ? 1 : 0)) as FeedbackValue[])
          : undefined;
      rows.push({ letters, feedback });
    } else if (hasPending && r === guessCount) {
      rows.push({ letters: pendingLetters, isPending: true });
    } else if (!hasPending && r === guessCount) {
      rows.push({
        letters: currentGuess.padEnd(WORD_LENGTH).slice(0, WORD_LENGTH).toUpperCase(),
      });
    } else {
      rows.push({ letters: ''.padEnd(WORD_LENGTH) });
    }
  }

  if (client === undefined) {
    return (
      <div className="rounded-2xl bg-white/10 p-8 text-center text-gray-300">
        Loading contract client…
      </div>
    );
  }

  if (!wordleService.isConfigured()) {
    return null;
  }

  const roleLabel = isWordSetter ? 'Word setter' : isGuesser ? 'Guesser' : 'Spectator';

  const gridBlock = (
    <div className="flex flex-col gap-1.5 rounded-xl bg-white/5 p-4">
      {rows.map((row, r) => (
        <div key={r} className="flex justify-center gap-1.5">
          {Array.from({ length: WORD_LENGTH }).map((_, c) => (
            <Cell
              key={c}
              letter={row.letters[c] ?? ' '}
              feedback={row.feedback?.[c]}
              isCurrent={r === (game?.guesses.length ?? 0) && !row.isPending && c === currentGuess.length}
              isPending={row.isPending}
            />
          ))}
        </div>
      ))}
      {hasPending && (
        <p className="text-center text-xs text-gray-400 mt-1">
          Word sent. Waiting for word setter to verify (green / yellow / gray).
        </p>
      )}
    </div>
  );

  const showGridWithSidebar =
    game?.phase === 'WaitingForWord' ||
    (isGuesser && game) ||
    (isWordSetter && game?.pending_guess) ||
    (!game && !!player1Address && !!player2Address);

  const guesserPanel = (
    <section
      className={`rounded-xl border p-5 transition-colors space-y-6 sm:mt-10 ${
        game?.phase === 'InProgress' && !game?.pending_guess
          ? 'border-wordle-correct/50 bg-wordle-correct/10'
          : 'border-white/20 bg-white/5'
      }`}
      aria-label="Guesser section"
    >
      <h3 className="text-center text-sm font-semibold uppercase tracking-wide text-gray-400 mb-2">
        Your turn — guess the word
      </h3>
      <div className="flex flex-col items-center space-y-3 mb-3">
        <label htmlFor="wordle-guess-input" className="text-sm text-gray-300 mb-2">
          Enter your word (5 letters)
        </label>
        <input
          id="wordle-guess-input"
          ref={guessInputRef}
          type="text"
          inputMode="text"
          autoComplete="off"
          maxLength={WORD_LENGTH}
          value={currentGuess}
          onChange={handleGuessInputChange}
          onKeyDown={handleGuessKeyDown}
          placeholder="A–Z"
          className="w-48 rounded-lg border-2 border-white/30 bg-white/10 px-4 py-3 text-center font-mono text-xl uppercase tracking-widest text-white placeholder:text-gray-500 focus:border-wordle-correct focus:outline-none focus:ring-2 focus:ring-wordle-correct/50"
          aria-label="5-letter word"
        />
      </div>
      <div className="flex flex-col items-center space-y-3 pt-1">
        <button
          type="button"
          onClick={submitGuess}
          disabled={loading || currentGuess.length !== WORD_LENGTH || !canSubmitGuess}
          className="rounded-lg bg-wordle-correct px-8 py-3 font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Sending…' : 'Send word'}
        </button>
        {currentGuess.length === WORD_LENGTH && !canSubmitGuess && (
          <p className="text-center text-xs text-gray-400 mt-3">
            {!game
              ? 'Loading game…'
              : game.phase !== 'InProgress'
                ? 'Game must be in progress.'
                : game.pending_guess
                  ? 'There is a guess pending verification.'
                  : 'You cannot submit more guesses.'}
          </p>
        )}
      </div>
    </section>
  );

  return (
    <div className={`mx-auto space-y-6 ${showGridWithSidebar ? 'max-w-3xl' : 'max-w-md'}`}>
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-wider text-white">WORDCHAIN</h1>
        <p className="mt-1 text-sm text-gray-300">
          Session {sessionId} · {game?.phase ?? '—'}
        </p>
        <div className="mt-2 flex justify-center">
          <span
            className={`inline-flex rounded-full px-3 py-1 mb-4 text-xs font-semibold uppercase tracking-wide ${
              isWordSetter
                ? 'bg-wordle-present/90 text-white'
                : isGuesser
                  ? 'bg-wordle-correct/90 text-white'
                  : 'bg-white/20 text-gray-400'
            }`}
          >
            You: {roleLabel}
          </span>
        </div>
      </div>

      {showGridWithSidebar ? (
        <div className="flex flex-col sm:flex-row sm:justify-center gap-6 sm:gap-10 items-center sm:items-start">
          <div className="shrink-0 flex justify-center sm:ml-82">
            {gridBlock}
          </div>
          <div className="w-full sm:w-72 shrink-0 space-y-8 sm:-mt-10">
            {game?.phase === 'WaitingForWord' ? (
              <>
                <div
                  className={`rounded-xl border p-4 ${isWordSetter ? 'border-wordle-present/50 bg-wordle-present/15 mb-2' : 'border-white/20 bg-white/5 sm:mt-10'}`}
                >
                  {isWordSetter ? (
                    <p className="text-center text-sm font-medium text-white">
                      Enter your secret word (5 letters) in the box below and click «Commit word».
                    </p>
                  ) : (
                    <p className="text-center text-sm text-gray-300">
                      Waiting for the word setter to commit their word. If you're testing both roles, switch to <strong>Player 1</strong> in the header.
                    </p>
                  )}
                </div>
                {isWordSetter && (
                  <section className="space-y-6 rounded-xl border border-wordle-present/40 bg-white/5 p-5" aria-label="Word setter — commit word">
                    <h3 className="text-center text-base font-semibold text-white mb-3">Your turn — commit secret word</h3>
                    <p className="text-center text-xs text-gray-400 mb-3">Choose a 5-letter word. The guesser will try to guess it.</p>
                    <div className="space-y-2 mb-3">
                      <label className="block text-xs text-gray-400 mb-1">Secret word (5 letters)</label>
                      <input
                        type="text"
                        maxLength={WORD_LENGTH}
                        value={secretWordCommit}
                        onChange={(e) => setSecretWordCommit(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, WORD_LENGTH))}
                        placeholder="e.g. WORDS"
                        className="w-full rounded border border-white/20 bg-white/5 px-3 py-2 font-mono text-white placeholder:text-gray-500"
                      />
                    </div>
                    <div className="space-y-2 mb-3">
                      <label className="block text-xs text-gray-400 mb-1">Salt (for commitment)</label>
                      <input
                        type="text"
                        value={commitSalt}
                        onChange={(e) => setCommitSalt(e.target.value.replace(/\D/g, '').slice(0, 20))}
                        placeholder="1"
                        className="w-full rounded border border-white/20 bg-white/5 px-3 py-2 text-white"
                      />
                    </div>
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={handleCommitWord}
                        disabled={commitWordLoading || secretWordCommit.length !== WORD_LENGTH}
                        className="w-full rounded-tl-2xl bg-wordle-present py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                      >
                        {commitWordLoading ? 'Sending…' : 'Commit word'}
                      </button>
                    </div>
                    <p className="text-center text-xs text-gray-500 pt-3">
                      Save the word and salt; you'll need them to resolve each guess.
                    </p>
                  </section>
                )}
              </>
            ) : game?.pending_guess && isWordSetter ? (
              <section className="space-y-4 rounded-xl border border-wordle-present/50 bg-wordle-present/10 p-5 sm:mt-10" aria-label="Word setter — resolve guess">
                <h3 className="text-center font-semibold text-white mb-3">Your turn — verify guess</h3>
                <p className="text-center text-sm text-gray-300 mb-3">
                  Pending guess: <strong className="uppercase text-white">{pendingGuessLetters}</strong>
                </p>
                <div>
                  <label className="mb-1 block text-sm text-gray-300 mb-2">Your secret word (5 letters)</label>
                  <input
                    type="text"
                    maxLength={WORD_LENGTH}
                    value={secretWordForResolve}
                    onChange={(e) => setSecretWordForResolve(e.target.value.toUpperCase().slice(0, WORD_LENGTH))}
                    placeholder="e.g. WORDS"
                    className="w-full rounded border border-white/20 bg-white/5 px-3 py-2 font-mono uppercase text-white placeholder:text-gray-500"
                  />
                </div>
                <div className="mt-4 mb-3">
                  <label className="mb-1 block text-sm text-gray-300 mb-2">Salt (same as when committing the word)</label>
                  <input
                    type="text"
                    value={resolveSalt}
                    onChange={(e) => setResolveSalt(e.target.value.replace(/\D/g, '').slice(0, 30))}
                    placeholder="1"
                    className="w-full rounded border border-white/20 bg-white/5 px-3 py-2 text-white"
                  />
                </div>
                {computedFeedback && (
                  <>
                    <p className="text-center text-xs text-gray-400 mb-3">
                      Green = correct · Yellow = wrong position · Gray = not in word.
                    </p>
                    <div className="flex justify-center gap-1">
                      {computedFeedback.map((f, i) => (
                        <div
                          key={i}
                          className={`flex h-10 w-10 items-center justify-center rounded text-lg font-bold uppercase text-white ${
                            f === FEEDBACK.CORRECT
                              ? 'bg-wordle-correct'
                              : f === FEEDBACK.PRESENT
                                ? 'bg-wordle-present'
                                : 'bg-wordle-absent'
                          }`}
                        >
                          {pendingGuessLetters[i] ?? '?'}
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <div className="flex justify-center pt-1 mt-3">
                  <button
                    type="button"
                    onClick={resolvePendingGuess}
                    disabled={
                      resolveLoading ||
                      secretWordForResolve.length !== WORD_LENGTH ||
                      !computedFeedback
                    }
                    className="w-full rounded-lg bg-wordle-present py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    {resolveLoading
                      ? resolvePhase === 'proving'
                        ? 'Generating proof…'
                        : resolvePhase === 'submitting'
                          ? 'Sending…'
                          : 'Resolving…'
                      : 'Resolve guess'}
                  </button>
                </div>
              </section>
            ) : !game && player1Address && player2Address ? (
              <div className="flex flex-col rounded-xl border border-white/20 bg-white/10 p-5 sm:mt-10 space-y-4">
                <h3 className="text-center font-semibold text-white mb-3">Create game</h3>
                <div className="text-center text-sm text-gray-300 space-y-1 mb-2">
                  <p>· Session {sessionId}</p>
                  <p>· Word setter: {player1Address.slice(0, 8)}…</p>
                  <p>· Guesser: {player2Address.slice(0, 8)}…</p>
                </div>
                {!isDevSignerAvailable() && (
                  <p className="text-center text-xs text-amber-200">
                    To create the game in one click, set VITE_DEV_PLAYER1_SECRET and VITE_DEV_PLAYER2_SECRET in .env (bun run setup).
                  </p>
                )}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleStartGame}
                    disabled={startGameLoading || !wordleService.isConfigured()}
                    className="w-full rounded-xl bg-wordle-correct py-2.5 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    {startGameLoading ? 'Creating…' : 'Start game'}
                  </button>
                </div>
              </div>
            ) : (
              isGuesser && guesserPanel
            )}
          </div>
        </div>
      ) : (
        gridBlock
      )}

      {game?.winner && (
        <p className="text-center text-lg font-semibold text-white mt-10">
          Game over. Winner: {game.winner === userAddress ? 'You!' : 'Opponent'}
        </p>
      )}

    </div>
  );
}
