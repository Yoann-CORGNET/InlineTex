/**
 * Pure LaTeX scanner: finds the spans InlineTeX renders in place.
 * No VS Code dependency, so it is unit-testable in plain Node.
 * Offsets are UTF-16 indices into the source string, end-exclusive.
 */

import { itemLabel, LIST_ENVS, parseListOptions, type ListKind, type ListLevel } from './lists';
import { tabularToArray } from './table';

export interface MathToken {
  type: 'math';
  start: number;
  end: number;
  /** Source passed to MathJax. */
  tex: string;
  display: boolean;
  /** A tabular converted to a MathJax array (see table.ts). */
  table?: boolean;
}

export type FormatKind =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'monospace'
  | 'color'
  | 'link'
  | 'part'
  | 'chapter'
  | 'section'
  | 'subsection'
  | 'subsubsection'
  | 'paragraph'
  /** Structural markup kept visible but dimmed (\begin{itemize}, \end{itemize}). */
  | 'muted';

export interface FormatToken {
  type: 'format';
  kind: FormatKind;
  start: number;
  end: number;
  /** Range of the argument shown with styling (between the braces). */
  argStart: number;
  argEnd: number;
  /** CSS color, for `color`. */
  color?: string;
  /** Link target, for `link`. */
  target?: string;
}

/**
 * How a replaced command is drawn: a plain glyph, a cross-reference, a label,
 * or a folded footnote.
 */
export type SymbolStyle = 'symbol' | 'ref' | 'label' | 'note';

export interface SymbolToken {
  type: 'symbol';
  start: number;
  end: number;
  /** Text drawn in place of the command (e.g. a bullet for \item). */
  text: string;
  style: SymbolStyle;
  /** Source shown on hover (footnote content). */
  hover?: string;
}

export interface ImageToken {
  type: 'image';
  start: number;
  end: number;
  /** Path as written in \includegraphics, relative to the root document. */
  path: string;
}

export type Token = MathToken | FormatToken | SymbolToken | ImageToken;

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

/** Table environments rendered as a MathJax array; the starred and X forms take a width first. */
const TABLE_ENVS = new Set(['tabular', 'tabular*', 'tabularx']);

/** Environments whose content must never be interpreted. */
const VERBATIM_ENVS = new Set(['verbatim', 'verbatim*', 'lstlisting', 'minted', 'comment', 'Verbatim']);

const SYMBOLS: Record<string, string> = {
  LaTeX: 'LaTeX',
  TeX: 'TeX',
  ldots: '…',
  dots: '…',
  textendash: '–',
  textemdash: '—',
};

/** Cross-reference commands and how their key is shown. */
const REFS: Record<string, (key: string) => string> = {
  ref: (k) => k,
  pageref: (k) => k,
  autoref: (k) => k,
  cref: (k) => k,
  Cref: (k) => k,
  eqref: (k) => `(${k})`,
};

const CITES = new Set(['cite', 'citep', 'citet', 'parencite', 'textcite', 'autocite', 'footcite']);

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

function superscript(n: number): string {
  return [...String(n)].map((d) => SUPERSCRIPT_DIGITS[Number(d)]).join('');
}

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

const BLANK_LINE_AT = /^\n[ \t\r]*\n/;

function blankLineAt(src: string, i: number): boolean {
  return src[i] === '\n' && BLANK_LINE_AT.test(src.slice(i, i + 64));
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

/** Index after a `[...]` optional argument at `i` (after spaces), or `i` if there is none. */
function skipOptional(src: string, i: number): number {
  let j = i;
  while (src[j] === ' ' || src[j] === '\t') {
    j++;
  }
  if (src[j] !== '[') {
    return i;
  }
  const close = matchBracket(src, j);
  return close === -1 ? i : close + 1;
}

/** Closing `]` of the `[` at `open`, skipping braced groups; -1 if none in the paragraph. */
function matchBracket(src: string, open: number): number {
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
function readGroup(src: string, i: number): { start: number; end: number; next: number } | undefined {
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

function readEnvName(src: string, i: number): { name: string; end: number } | undefined {
  const m = /^\{([A-Za-z*]+)\}/.exec(src.slice(i, i + 40));
  return m ? { name: m[1], end: i + m[0].length } : undefined;
}

/** Result of a sub-scanner: an optional token and where to resume. */
interface Step {
  token?: Token;
  next: number;
}

/** Per-scan state shared by the sub-scanners. */
interface ScanState {
  footnotes: number;
  /** Open list environments, outermost first. */
  lists: ListLevel[];
  /** Last counter of each closed enumerate, by nesting depth, for enumitem's `resume`. */
  lastCounters: Map<number, number>;
}

/** Depth (1-based) of the innermost list among the open lists of the same kind. */
function listDepth(state: ScanState): number {
  const top = state.lists.at(-1);
  return top ? state.lists.filter((l) => l.kind === top.kind).length : 0;
}

/** A dimmed span: nothing is hidden, the whole range is styled. */
function muted(start: number, end: number): Token {
  return { type: 'format', kind: 'muted', start, end, argStart: start, argEnd: end };
}

/** \begin{itemize|enumerate|description}[options]: open a list level. */
function beginList(src: string, i: number, kind: ListKind, afterName: number, state: ScanState): Step {
  const optEnd = skipOptional(src, afterName);
  const options = optEnd === afterName ? undefined : src.slice(src.indexOf('[', afterName) + 1, optEnd - 1);
  const parsed = options === undefined ? {} : parseListOptions(kind, options);
  const level: ListLevel = { kind, counter: 0, format: parsed.format };
  state.lists.push(level);
  if (kind === 'enumerate') {
    const depth = listDepth(state);
    if (parsed.resume) {
      level.counter = state.lastCounters.get(depth) ?? 0;
    } else if (parsed.start !== undefined && Number.isFinite(parsed.start)) {
      level.counter = parsed.start - 1;
    }
  }
  return { token: muted(i, optEnd), next: optEnd };
}

/** \end{...}: close a list level; other environments are left alone. */
function scanEnd(src: string, i: number, afterCmd: number, state: ScanState): Step {
  const env = readEnvName(src, afterCmd);
  if (!env || !LIST_ENVS.has(env.name)) {
    return { next: afterCmd };
  }
  const at = state.lists.map((l) => l.kind).lastIndexOf(env.name as ListKind);
  if (at !== -1) {
    if (env.name === 'enumerate') {
      const depth = state.lists.slice(0, at + 1).filter((l) => l.kind === 'enumerate').length;
      state.lastCounters.set(depth, state.lists[at].counter);
    }
    state.lists.length = at;
  }
  return { token: muted(i, env.end), next: env.end };
}

/** \setcounter{enumi..enumiv}{n} and \addtocounter: adjust the matching enumerate level. */
function scanCounter(src: string, afterCmd: number, add: boolean, state: ScanState): Step {
  const name = readGroup(src, afterCmd);
  const value = name && readGroup(src, name.next);
  if (!name || !value) {
    return { next: afterCmd };
  }
  const level = ['enumi', 'enumii', 'enumiii', 'enumiv'].indexOf(src.slice(name.start, name.end).trim()) + 1;
  const n = Number.parseInt(src.slice(value.start, value.end), 10);
  const target = state.lists.filter((l) => l.kind === 'enumerate')[level - 1];
  if (target && Number.isFinite(n)) {
    target.counter = add ? target.counter + n : n;
  }
  return { next: value.next };
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

function scanBegin(src: string, i: number, afterCmd: number, state: ScanState): Step {
  const env = readEnvName(src, afterCmd);
  if (!env) {
    return { next: afterCmd };
  }
  if (LIST_ENVS.has(env.name)) {
    return beginList(src, i, env.name as ListKind, env.end, state);
  }
  const endMarker = String.raw`\end{${env.name}}`;
  if (VERBATIM_ENVS.has(env.name)) {
    const closeAt = src.indexOf(endMarker, env.end);
    return { next: closeAt === -1 ? src.length : closeAt + endMarker.length };
  }
  if (TABLE_ENVS.has(env.name)) {
    return scanTable(src, i, env.name, env.end, endMarker);
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

/** \begin{tabular}[pos]{spec} ... \end{tabular}, and tabular* / tabularx with their width. */
function scanTable(src: string, i: number, name: string, afterName: number, endMarker: string): Step {
  let at = afterName;
  if (name !== 'tabular') {
    at = readGroup(src, at)?.next ?? -1;
  }
  const spec = at === -1 ? undefined : readGroup(src, skipOptional(src, at));
  const closeAt = spec ? findClose(src, spec.next, endMarker) : -1;
  if (!spec || closeAt === -1) {
    return { next: afterName };
  }
  const end = closeAt + endMarker.length;
  const tex = tabularToArray(src.slice(spec.start, spec.end), src.slice(spec.next, closeAt));
  return { token: { type: 'math', start: i, end, tex, display: true, table: true }, next: end };
}

function scanFormat(src: string, i: number, cmd: string, kind: FormatKind): Step {
  const afterCmd = i + 1 + cmd.length;
  let open = afterCmd;
  if (SECTIONING.has(cmd)) {
    open += src[open] === '*' ? 1 : 0;
    // \section[short title]{Full title}: the full title is what the reader sees.
    open = skipOptional(src, open);
  }
  const arg = readGroup(src, open);
  if (!arg) {
    return { next: afterCmd };
  }
  // Resume inside the argument: it may hold math or nested formatting.
  return {
    token: { type: 'format', kind, start: i, end: arg.next, argStart: arg.start, argEnd: arg.end },
    next: arg.start,
  };
}

/** Convert an xcolor specification to CSS, or undefined if it is not one we can map. */
export function cssColor(model: string | undefined, value: string): string | undefined {
  const v = value.trim();
  if (!model) {
    return /^[A-Za-z]+$/.test(v) ? v.toLowerCase() : undefined;
  }
  if (model === 'HTML' && /^[0-9A-Fa-f]{6}$/.test(v)) {
    return `#${v}`;
  }
  const parts = v.split(',').map((p) => Number(p.trim()));
  if (parts.some((p) => !Number.isFinite(p))) {
    return undefined;
  }
  if (model === 'rgb' && parts.length === 3) {
    return `rgb(${parts.map((p) => Math.round(p * 255)).join(', ')})`;
  }
  if (model === 'RGB' && parts.length === 3) {
    return `rgb(${parts.join(', ')})`;
  }
  if (model === 'gray' && parts.length === 1) {
    const g = Math.round(parts[0] * 255);
    return `rgb(${g}, ${g}, ${g})`;
  }
  return undefined;
}

/** \textcolor[model]{spec}{text}. */
function scanTextcolor(src: string, i: number, afterCmd: number): Step {
  let at = afterCmd;
  let model: string | undefined;
  const opt = skipOptional(src, at);
  if (opt !== at) {
    model = src.slice(src.indexOf('[', at) + 1, opt - 1).trim();
    at = opt;
  }
  const spec = readGroup(src, at);
  const arg = spec && readGroup(src, spec.next);
  const color = spec && cssColor(model, src.slice(spec.start, spec.end));
  if (!arg || !color) {
    return { next: afterCmd };
  }
  return {
    token: { type: 'format', kind: 'color', start: i, end: arg.next, argStart: arg.start, argEnd: arg.end, color },
    next: arg.start,
  };
}

/** \href{url}{text}: the text is styled as a link, the URL is kept for hover. */
function scanHref(src: string, i: number, afterCmd: number): Step {
  const urlClose = src[afterCmd] === '{' ? src.indexOf('}', afterCmd) : -1;
  const arg = urlClose === -1 ? undefined : readGroup(src, urlClose + 1);
  if (!arg) {
    return { next: afterCmd };
  }
  const target = src.slice(afterCmd + 1, urlClose);
  return {
    token: { type: 'format', kind: 'link', start: i, end: arg.next, argStart: arg.start, argEnd: arg.end, target },
    next: arg.start,
  };
}

/** \url{...} and \path{...}: literal argument (% and $ are not special), styled as a link. */
function scanUrl(src: string, i: number, afterCmd: number): Step {
  const close = src.indexOf('}', afterCmd);
  const eol = src.indexOf('\n', afterCmd);
  if (close === -1 || (eol !== -1 && eol < close)) {
    return { next: afterCmd };
  }
  const target = src.slice(afterCmd + 1, close);
  return {
    token: { type: 'format', kind: 'link', start: i, end: close + 1, argStart: afterCmd + 1, argEnd: close, target },
    next: close + 1,
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

/**
 * Commands replaced by a short text: references, citations, labels and
 * footnotes. Their argument is not scanned further.
 */
function scanReplaced(src: string, i: number, cmd: string, afterCmd: number, state: ScanState): Step | undefined {
  const isRef = cmd in REFS;
  const isCite = CITES.has(cmd);
  if (!isRef && !isCite && cmd !== 'label' && cmd !== 'footnote') {
    return undefined;
  }
  // Citations take up to two optional arguments (\cite[p.~3]{key}), footnotes one.
  let at = afterCmd;
  for (let n = 0; n < 2 && (isCite || (cmd === 'footnote' && n === 0)); n++) {
    at = skipOptional(src, at);
  }
  const arg = readGroup(src, at);
  if (!arg) {
    return { next: afterCmd };
  }
  const content = src.slice(arg.start, arg.end);
  const base = { type: 'symbol' as const, start: i, end: arg.next };
  if (cmd === 'footnote') {
    state.footnotes++;
    return { token: { ...base, text: superscript(state.footnotes), style: 'note', hover: content.trim() }, next: arg.next };
  }
  if (cmd === 'label') {
    return { token: { ...base, text: content.trim(), style: 'label' }, next: arg.next };
  }
  const keys = content.split(',').map((k) => k.trim()).filter(Boolean);
  const text = isCite ? `[${keys.join(', ')}]` : REFS[cmd](content.trim());
  return { token: { ...base, text, style: 'ref' }, next: arg.next };
}

/** \includegraphics[options]{path}. */
function scanGraphics(src: string, i: number, afterCmd: number): Step {
  let at = afterCmd + (src[afterCmd] === '*' ? 1 : 0);
  at = skipOptional(src, at);
  const arg = readGroup(src, at);
  if (!arg) {
    return { next: afterCmd };
  }
  return { token: { type: 'image', start: i, end: arg.next, path: src.slice(arg.start, arg.end).trim() }, next: arg.next };
}

/** \item, or \item[label] whose label is shown in bold. */
/**
 * \item: the bullet or number of the enclosing list, by nesting level. With an
 * explicit label, \item[label], the label is shown in bold and the counter
 * does not move, as in LaTeX.
 */
function scanItem(src: string, i: number, afterCmd: number, state: ScanState): Step {
  if (src[afterCmd] === '[') {
    const close = matchBracket(src, afterCmd);
    if (close !== -1) {
      return {
        token: { type: 'format', kind: 'bold', start: i, end: close + 1, argStart: afterCmd + 1, argEnd: close },
        next: afterCmd + 1,
      };
    }
  }
  const level = state.lists.at(-1);
  if (level?.kind === 'enumerate') {
    level.counter++;
  }
  const text = itemLabel(level, listDepth(state));
  return { token: { type: 'symbol', start: i, end: afterCmd, text, style: 'symbol' }, next: afterCmd };
}

function scanCommand(src: string, i: number, state: ScanState): Step {
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
  switch (cmd) {
    case 'begin':
      return scanBegin(src, i, afterCmd, state);
    case 'verb':
      return { next: skipVerb(src, afterCmd) };
    case 'url':
    case 'path':
      return src[afterCmd] === '{' ? scanUrl(src, i, afterCmd) : { next: afterCmd };
    case 'href':
      return scanHref(src, i, afterCmd);
    case 'textcolor':
      return scanTextcolor(src, i, afterCmd);
    case 'includegraphics':
      return scanGraphics(src, i, afterCmd);
    case 'item':
      return scanItem(src, i, afterCmd, state);
    case 'end':
      return scanEnd(src, i, afterCmd, state);
    case 'setcounter':
    case 'addtocounter':
      return scanCounter(src, afterCmd, cmd === 'addtocounter', state);
  }
  const replaced = scanReplaced(src, i, cmd, afterCmd, state);
  if (replaced) {
    return replaced;
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
  return { token: { type: 'symbol', start: i, end, text: symbol, style: 'symbol' }, next: end };
}

/** Scan a LaTeX document. Tokens come in source order (by `start`). */
export function scan(src: string): Token[] {
  const tokens: Token[] = [];
  const state: ScanState = { footnotes: 0, lists: [], lastCounters: new Map() };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    let step: Step;
    if (c === '%') {
      step = { next: skipComment(src, i) };
    } else if (c === '$') {
      step = scanDollar(src, i);
    } else if (c === '\\') {
      step = scanCommand(src, i, state);
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
