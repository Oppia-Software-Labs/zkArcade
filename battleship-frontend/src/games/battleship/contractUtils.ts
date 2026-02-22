import { Buffer } from 'buffer';
import type { Game, GamePhase } from './bindings';

/** Unwrap Option<Buffer> from contract (tag/values or raw Buffer). */
export function unwrapOptionBuffer(opt: Game['board_commitment_p1']): Buffer | null {
  if (opt == null || opt === undefined) return null;
  if (Buffer.isBuffer(opt)) return opt;
  const o = opt as { tag?: string; values?: unknown[] };
  if (o.tag === 'Some' && Array.isArray(o.values) && o.values[0] != null && Buffer.isBuffer(o.values[0])) {
    return o.values[0] as Buffer;
  }
  return null;
}

/** Unwrap Option<string> from contract (tag/values or raw string). */
export function unwrapOptionString(opt: Game['pending_shot_shooter']): string | null {
  if (opt == null || opt === undefined) return null;
  if (typeof opt === 'string') return opt;
  const o = opt as { tag?: string; values?: unknown[] };
  if (o.tag === 'Some' && Array.isArray(o.values) && o.values[0] != null && typeof o.values[0] === 'string') {
    return o.values[0] as string;
  }
  return null;
}

export function phaseFromGame(phase: GamePhase): 'placement' | 'battle' | 'ended' {
  if (phase.tag === 'WaitingForBoards') return 'placement';
  if (phase.tag === 'InProgress') return 'battle';
  return 'ended';
}
