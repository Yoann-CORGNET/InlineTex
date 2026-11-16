/**
 * Which tokens get decorated in a pass, computed on plain offsets: no VS Code
 * dependency, so the reveal and visibility rules are unit-testable.
 */
import type { Token } from '../parser/scan';

/** Half-open offset range [start, end). Touching ranges count as overlapping. */
export interface OffsetRange {
  start: number;
  end: number;
}

export type RevealOn = 'cursor' | 'line';

/** Offset of the first character of each line. */
export function lineStarts(src: string): number[] {
  const starts = [0];
  for (let i = src.indexOf('\n'); i !== -1; i = src.indexOf('\n', i + 1)) {
    starts.push(i + 1);
  }
  return starts;
}

/** Zero-based line containing `offset`. */
export function lineAt(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/** Offset range covering lines [firstLine - margin, lastLine + margin]. */
export function linesToOffsets(
  starts: readonly number[],
  textLength: number,
  firstLine: number,
  lastLine: number,
  margin: number,
): OffsetRange {
  const from = Math.max(0, firstLine - margin);
  const to = lastLine + margin + 1;
  return { start: starts[Math.min(from, starts.length - 1)], end: to < starts.length ? starts[to] : textLength };
}

function overlaps(a: OffsetRange, b: OffsetRange): boolean {
  return a.start <= b.end && a.end >= b.start;
}

/** True when a selection touches the token, so its source must be shown. */
export function isRevealed(
  token: OffsetRange,
  selections: readonly OffsetRange[],
  revealOn: RevealOn,
  starts: readonly number[],
): boolean {
  if (revealOn === 'cursor') {
    return selections.some((s) => overlaps(s, token));
  }
  const first = lineAt(starts, token.start);
  const last = lineAt(starts, token.end);
  return selections.some((s) => lineAt(starts, s.start) <= last && lineAt(starts, s.end) >= first);
}

export interface PlanInput {
  tokens: readonly Token[];
  lineStarts: readonly number[];
  /** Ranges worth decorating (visible lines plus a margin). */
  visible: readonly OffsetRange[];
  selections: readonly OffsetRange[];
  revealOn: RevealOn;
}

/**
 * Tokens to decorate: on screen (or close to it) and not touched by a
 * selection. Token ends are not sorted (a format token encloses later ones),
 * so every token is tested; the test is two integer comparisons.
 */
export function tokensToDecorate(input: PlanInput): Token[] {
  return input.tokens.filter(
    (t) =>
      input.visible.some((v) => overlaps(v, t)) &&
      !isRevealed(t, input.selections, input.revealOn, input.lineStarts),
  );
}

/** Number of blank lines right after `line` (at most `max`): display content may draw over them. */
export function blankLinesAfter(src: string, starts: readonly number[], line: number, max: number): number {
  let n = 0;
  while (n < max && line + n + 1 < starts.length) {
    const next = line + n + 1;
    const end = next + 1 < starts.length ? starts[next + 1] : src.length;
    if (src.slice(starts[next], end).trim() !== '') {
      break;
    }
    n++;
  }
  return n;
}
