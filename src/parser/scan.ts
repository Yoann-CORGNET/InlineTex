/**
 * Pure LaTeX scanner: finds the spans InlineTeX renders in place.
 * No VS Code dependency, so it is unit-testable in plain Node.
 * Offsets are UTF-16 indices into the source string, end-exclusive.
 */

export interface MathToken {
  type: 'math';
  start: number;
  end: number;
  /** Source passed to MathJax. */
  tex: string;
  display: boolean;
}

export type FormatKind =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'monospace'
  | 'part'
  | 'chapter'
  | 'section'
  | 'subsection'
  | 'subsubsection'
  | 'paragraph';

export interface FormatToken {
  type: 'format';
  kind: FormatKind;
  start: number;
  end: number;
  /** Range of the argument shown with styling (between the braces). */
  argStart: number;
  argEnd: number;
}

export interface SymbolToken {
  type: 'symbol';
  start: number;
  end: number;
  /** Text drawn in place of the command (e.g. a bullet for \item). */
  text: string;
}

export type Token = MathToken | FormatToken | SymbolToken;

const FORMAT_COMMANDS: Record<string, FormatKind> = {
  textbf: 'bold',
  textit: 'italic',
  textsl: 'italic',
  emph: 'italic',
  underline: 'underline',
  texttt: 'monospace',
  part: 'part',
  chapter: 'chapter',
  section: 'section',
  subsection: 'subsection',
  subsubsection: 'subsubsection',
  paragraph: 'paragraph',
};

const SECTIONING = new Set(['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph']);

/** Environments MathJax understands as-is (the whole \begin..\end is passed). */
const MATHJAX_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*',
  'flalign', 'flalign*', 'alignat', 'alignat*', 'eqnarray', 'eqnarray*',
]);

/** Environments whose body is display math but that MathJax does not know by name. */
const BODY_ENVS = new Set(['displaymath', 'math']);

/** Environments whose content must never be interpreted. */
const VERBATIM_ENVS = new Set(['verbatim', 'verbatim*', 'lstlisting', 'minted', 'comment', 'Verbatim']);

const SYMBOLS: Record<string, string> = {
  item: '•',
  LaTeX: 'LaTeX',
  TeX: 'TeX',
  ldots: '…',
  dots: '…',
  textendash: '–',
  textemdash: '—',
};

function isLetter(c: string | undefined): boolean {
  return c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));
}

/** Read a control word starting at the backslash at `i`. */
function readCommand(src: string, i: number): string {
  let j = i + 1;
  while (isLetter(src[j])) {
    j++;
  }
  return src.slice(i + 1, j);
}

/** Index just past the end of the line containing `i` (or src.length). */
function skipComment(src: string, i: number): number {
  const nl = src.indexOf('\n', i);
  return nl === -1 ? src.length : nl;
}

/**
 * Find the brace matching the `{` at `open`. Honours escapes and comments.
 * Returns the index of the closing `}` or -1.
 */
export function matchBrace(src: string, open: number): number {
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
    }
    i++;
  }
  return -1;
}

const BLANK_LINE = /\n[ \t\r]*\n/;
const BLANK_LINE_AT = /^\n[ \t\r]*\n/;

/**
 * Find `close` starting at `from`, skipping escaped chars and comments.
 * Math never spans a blank line (TeX ends the paragraph, amsmath errors out),
 * which bounds the damage of an unclosed delimiter while typing.
 * Balanced `{...}` groups are skipped whole: a `$` inside `\text{...}` is nested math.
 */
function findClose(src: string, from: number, close: string): number {
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
    } else if (c === '\n' && BLANK_LINE_AT.test(src.slice(i, i + 64))) {
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
  const close = matchBrace(src, open);
  if (close === -1 || BLANK_LINE.test(src.slice(open, close))) {
    return open + 1;
  }
  return close + 1;
}

function readEnvName(src: string, i: number): { name: string; end: number } | undefined {
  const m = /^\{([A-Za-z*]+)\}/.exec(src.slice(i, i + 40));
  return m ? { name: m[1], end: i + m[0].length } : undefined;
}

/** Result of a sub-scanner: an optional token and where to resume. */
interface Step {
  token?: Token;
  next: number;
}

function scanDollar(src: string, i: number): Step {
  const display = src[i + 1] === '$';
  const openLen = display ? 2 : 1;
  const closeAt = findClose(src, i + openLen, display ? '$$' : '$');
  if (closeAt <= i + openLen) {
    return { next: i + openLen };
  }
  const end = closeAt + openLen;
  return { token: { type: 'math', start: i, end, tex: src.slice(i + openLen, closeAt), display }, next: end };
}

/** \( ... \) and \[ ... \]. */
function scanBracketMath(src: string, i: number): Step {
  const display = src[i + 1] === '[';
  const closeAt = findClose(src, i + 2, display ? String.raw`\]` : String.raw`\)`);
  if (closeAt <= i + 2) {
    return { next: i + 2 };
  }
  const end = closeAt + 2;
  return { token: { type: 'math', start: i, end, tex: src.slice(i + 2, closeAt), display }, next: end };
}

function scanBegin(src: string, i: number, afterCmd: number): Step {
  const env = readEnvName(src, afterCmd);
  if (!env) {
    return { next: afterCmd };
  }
  const endMarker = String.raw`\end{` + env.name + '}';
  if (VERBATIM_ENVS.has(env.name)) {
    const closeAt = src.indexOf(endMarker, env.end);
    return { next: closeAt === -1 ? src.length : closeAt + endMarker.length };
  }
  const whole = MATHJAX_ENVS.has(env.name);
  if (!whole && !BODY_ENVS.has(env.name)) {
    return { next: afterCmd };
  }
  const closeAt = findClose(src, env.end, endMarker);
  if (closeAt === -1) {
    return { next: afterCmd };
  }
  const end = closeAt + endMarker.length;
  const tex = whole ? src.slice(i, end) : src.slice(env.end, closeAt);
  return { token: { type: 'math', start: i, end, tex, display: env.name !== 'math' }, next: end };
}

function scanFormat(src: string, i: number, cmd: string, kind: FormatKind): Step {
  const afterCmd = i + 1 + cmd.length;
  let open = afterCmd;
  if (SECTIONING.has(cmd) && src[open] === '*') {
    open++;
  }
  const closeAt = src[open] === '{' ? matchBrace(src, open) : -1;
  if (closeAt === -1) {
    return { next: afterCmd };
  }
  // Resume inside the argument: it may hold math or nested formatting.
  return {
    token: { type: 'format', kind, start: i, end: closeAt + 1, argStart: open + 1, argEnd: closeAt },
    next: open + 1,
  };
}

/** \verb|...| and \verb*|...|: the delimiter is the next character. */
function skipVerb(src: string, afterCmd: number): number {
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

function scanCommand(src: string, i: number): Step {
  const next = src[i + 1];
  if (next === '(' || next === '[') {
    return scanBracketMath(src, i);
  }
  const cmd = readCommand(src, i);
  if (cmd === '') {
    // Control symbol such as \$, \%, \\ : skip both characters.
    return { next: i + 2 };
  }
  const afterCmd = i + 1 + cmd.length;
  if (cmd === 'begin') {
    return scanBegin(src, i, afterCmd);
  }
  if (cmd === 'verb') {
    return { next: skipVerb(src, afterCmd) };
  }
  if ((cmd === 'url' || cmd === 'path') && src[afterCmd] === '{') {
    // Literal argument: % and $ inside a URL are not special.
    const close = src.indexOf('}', afterCmd);
    return { next: close === -1 ? afterCmd : close + 1 };
  }
  const kind = FORMAT_COMMANDS[cmd];
  if (kind) {
    return scanFormat(src, i, cmd, kind);
  }
  const symbol = SYMBOLS[cmd];
  if (symbol === undefined) {
    return { next: afterCmd };
  }
  const end = src.startsWith('{}', afterCmd) ? afterCmd + 2 : afterCmd;
  return { token: { type: 'symbol', start: i, end, text: symbol }, next: end };
}

export function scan(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    let step: Step;
    if (c === '%') {
      step = { next: skipComment(src, i) };
    } else if (c === '$') {
      step = scanDollar(src, i);
    } else if (c === '\\') {
      step = scanCommand(src, i);
    } else {
      step = { next: i + 1 };
    }
    if (step.token) {
      tokens.push(step.token);
    }
    i = step.next;
  }
  return tokens;
}
