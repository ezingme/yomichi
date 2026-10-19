/** Dynamic state of one synchronous Ichiran-compatible run, mirroring the
 * special variables of the original Lisp (*substring-hash*, *suffix-map-temp*,
 * *suffix-next-end*, *disable-hints*). Analysis runs are synchronous, so one
 * module-level state object is safe. */
import type { IchiranStore, ReadingRow } from "./store.js";
import type { SuffixItem } from "./grammar.js";

export interface RunState {
  store: IchiranStore;
  /** Substring keys of the current sentence -> rows in upstream hash order. */
  substringHash: Map<string, ReadingRow[]> | null;
  suffixMapTemp: Map<number, SuffixItem[]> | null;
  suffixNextEnd: number | null;
  disableHints: boolean;
}

let current: RunState | null = null;

export function S(): RunState {
  if (!current) throw new Error("No active Ichiran run");
  return current;
}
export function withState<T>(state: RunState, fn: () => T): T {
  const prev = current;
  current = state;
  try {
    return fn();
  } finally {
    current = prev;
  }
}
/** Temporarily rebind dynamic variables (Lisp `let` of special variables). */
export function bind<T>(patch: Partial<RunState>, fn: () => T): T {
  const s = S();
  const saved: Partial<RunState> = {};
  for (const k of Object.keys(patch) as (keyof RunState)[])
    (saved as any)[k] = s[k];
  Object.assign(s, patch);
  try {
    return fn();
  } finally {
    Object.assign(s, saved);
  }
}
