/**
 * Low-level LaTeX reading: commands, comments, braced and bracketed
 * arguments, delimiters. Each helper honours escapes, and most stop at a
 * blank line so that an unclosed delimiter being typed cannot reach far ahead.
 */

function isLetter(c: string | undefined): boolean {
  return c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));
}

/** Read a control word starting at the backslash at `i`. */
export function readCommand(src: string, i: number): string {
  let j = i + 1;
  while (isLetter(src[j])) {
    j++;
  }
  return src.slice(i + 1, j);
}

/** Index just past the end of the line containing `i` (or src.length). */
export function skipComment(src: string, i: number): number {
  const nl = src.indexOf('\n', i);
  return nl === -1 ? src.length : nl;
}

const BLANK_LINE_AT = /\n[ \t\r]*\n/y;

/** True when a blank line (paragraph break) starts at `i`. */
export function blankLineAt(src: string, i: number): boolean {
  if (src[i] !== '\n') {
    return false;
  }
  BLANK_LINE_AT.lastIndex = i;
  return BLANK_LINE_AT.test(src);
}

/**
 * Find the brace matching the `{` at `open`. Honours escapes and comments.
 * With `withinParagraph`, gives up at a blank line, like TeX does for most
 * arguments: an unclosed brace being typed then cannot reach far ahead.
 * Returns the index of the closing `}` or -1.
 */
export function matchBrace(src: string, open: number, withinParagraph = false): number {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '%') {
      i = skipComment(src, i);
      continue;
    }
    if (c === '{') {
      depth++;
    } else if (c === '}' && --depth === 0) {
      return i;
    } else if (withinParagraph && blankLineAt(src, i)) {
      return -1;
    }
    i++;
  }
  return -1;
}

/**
 * Remove `%` comments: an unescaped `%` runs to the end of the line. A backslash
 * escapes the next character only, so `\\%` is a line break then a comment.
 */
export function stripComments(src: string): string {
  let out = '';
  let from = 0;
  let i = 0;
  while (i < src.length) {
    if (src[i] === '\\') {
      i += 2;
    } else if (src[i] === '%') {
      out += src.slice(from, i);
      i = src.indexOf('\n', i);
      if (i === -1) {
        return out;
      }
      from = i;
    } else {
      i++;
    }
  }
  return out + src.slice(from);
}

/** A `[...]` optional argument at `i` (after spaces): its content range and the index after it. */
export function readOptional(src: string, i: number): { start: number; end: number; next: number } | undefined {
  let j = i;
  while (src[j] === ' ' || src[j] === '\t') {
    j++;
  }
  if (src[j] !== '[') {
    return undefined;
  }
  const close = matchBracket(src, j);
  return close === -1 ? undefined : { start: j + 1, end: close, next: close + 1 };
}

/** Index after a `[...]` optional argument at `i`, or `i` if there is none. */
export function skipOptional(src: string, i: number): number {
  return readOptional(src, i)?.next ?? i;
}

/** Closing `]` of the `[` at `open`, skipping braced groups; -1 if none in the paragraph. */
export function matchBracket(src: string, open: number): number {
  let i = open + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === ']') {
      return i;
    }
    if (c === '\\') {
      i += 2;
    } else if (c === '{') {
      const close = matchBrace(src, i, true);
      if (close === -1) {
        return -1;
      }
      i = close + 1;
    } else if (blankLineAt(src, i)) {
      return -1;
    } else {
      i++;
    }
  }
  return -1;
}

/** A mandatory `{...}` argument at `i`: its content range and the index after it. */
export function readGroup(src: string, i: number): { start: number; end: number; next: number } | undefined {
  if (src[i] !== '{') {
    return undefined;
  }
  const close = matchBrace(src, i, true);
  return close === -1 ? undefined : { start: i + 1, end: close, next: close + 1 };
}

/**
 * Find `close` starting at `from`, skipping escaped chars and comments.
 * Math never spans a blank line (TeX ends the paragraph, amsmath errors out),
 * which bounds the damage of an unclosed delimiter while typing.
 * Balanced `{...}` groups are skipped whole: a `$` inside `\text{...}` is nested math.
 */
export function findClose(src: string, from: number, close: string): number {
  let i = from;
  while (i < src.length) {
    if (src.startsWith(close, i)) {
      return i;
    }
    const c = src[i];
    if (c === '\\') {
      i += 2;
    } else if (c === '%') {
      i = skipComment(src, i);
    } else if (blankLineAt(src, i)) {
      return -1;
    } else if (c === '{') {
      i = skipGroup(src, i);
    } else {
      i++;
    }
  }
  return -1;
}

/** Index after the group opened at `open`, or open + 1 if unbalanced within the paragraph. */
function skipGroup(src: string, open: number): number {
  const close = matchBrace(src, open, true);
  return close === -1 ? open + 1 : close + 1;
}

export function readEnvName(src: string, i: number): { name: string; end: number } | undefined {
  const m = /^\{([A-Za-z*]+)\}/.exec(src.slice(i, i + 40));
  return m ? { name: m[1], end: i + m[0].length } : undefined;
}

/** \verb|...| and \verb*|...|: the delimiter is the next character. */
export function skipVerb(src: string, afterCmd: number): number {
  const at = src[afterCmd] === '*' ? afterCmd + 1 : afterCmd;
  const delim = src[at];
  if (delim === undefined || delim === '\n') {
    return at;
  }
  const close = src.indexOf(delim, at + 1);
  const eol = src.indexOf('\n', at + 1);
  if (close === -1 || (eol !== -1 && eol < close)) {
    return at + 1;
  }
  return close + 1;
}
