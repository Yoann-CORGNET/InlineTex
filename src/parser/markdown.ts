/**
 * Math scanner for Markdown, following the Pandoc / VS Code preview rules:
 * `$$...$$` is display math, `$...$` is inline math only when the opening `$`
 * is followed by a non-space and the closing `$` is preceded by a non-space and
 * not followed by a digit (so "$5 and $10" stays text). Code fences and code
 * spans are skipped, `\` escapes the next character, and `%` is plain text.
 */
import { blankLineAt } from './syntax';
import type { MathToken } from './tokens';

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Index of the start of the line after the one containing `i`. */
function nextLine(src: string, i: number): number {
  const nl = src.indexOf('\n', i);
  return nl === -1 ? src.length : nl + 1;
}

/** Index after a fenced code block starting at line start `i`, or -1 if none starts here. */
function skipFence(src: string, i: number): number {
  const open = FENCE.exec(src.slice(i, nextLine(src, i)));
  if (!open) {
    return -1;
  }
  const marker = open[1];
  let line = nextLine(src, i);
  while (line < src.length) {
    const text = src.slice(line, nextLine(src, line));
    const close = FENCE.exec(text);
    if (close && close[1][0] === marker[0] && close[1].length >= marker.length && text.trim() === close[1]) {
      return nextLine(src, line);
    }
    line = nextLine(src, line);
  }
  return src.length;
}

/** Index after a code span opened by the backtick run at `i`, or after the run if unclosed. */
function skipCodeSpan(src: string, i: number): number {
  let n = 0;
  while (src[i + n] === '`') {
    n++;
  }
  const run = '`'.repeat(n);
  let at = src.indexOf(run, i + n);
  while (at !== -1 && src[at + n] === '`') {
    let skip = at;
    while (src[skip] === '`') {
      skip++;
    }
    at = src.indexOf(run, skip);
  }
  return at === -1 ? i + n : at + n;
}

function isSpace(c: string | undefined): boolean {
  return c === undefined || c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

/** Closing delimiter of math opened at `from`, within the paragraph; -1 if none. */
function findClose(src: string, from: number, display: boolean): number {
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    // A code span ends the search: inline math never contains a backtick, and
    // "$5 ... `$HOME`" must not pair a price with a dollar inside code.
    if (blankLineAt(src, i) || (!display && c === '`')) {
      return -1;
    }
    if (c === '$') {
      if (display) {
        if (src[i + 1] === '$') {
          return i;
        }
      } else if (!isSpace(src[i - 1]) && !/\d/.test(src[i + 1] ?? '')) {
        return i;
      }
    }
    i++;
  }
  return -1;
}

export function scanMarkdown(src: string): MathToken[] {
  const tokens: MathToken[] = [];
  let i = 0;
  let lineStart = true;
  while (i < src.length) {
    if (lineStart) {
      const fenceEnd = skipFence(src, i);
      if (fenceEnd !== -1) {
        i = fenceEnd;
        continue;
      }
    }
    const c = src[i];
    lineStart = c === '\n';
    if (c === '\\') {
      i += 2;
    } else if (c === '`') {
      i = skipCodeSpan(src, i);
    } else if (c === '$') {
      i = scanDollar(src, i, tokens);
    } else {
      i++;
    }
  }
  return tokens;
}

function scanDollar(src: string, i: number, tokens: MathToken[]): number {
  const display = src[i + 1] === '$';
  const open = i + (display ? 2 : 1);
  if (!display && isSpace(src[open])) {
    return open;
  }
  const close = findClose(src, open, display);
  if (close === -1 || close === open) {
    return open;
  }
  const end = close + (display ? 2 : 1);
  tokens.push({ type: 'math', start: i, end, tex: src.slice(open, close), display });
  return end;
}
