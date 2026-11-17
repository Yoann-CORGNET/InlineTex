/**
 * Pure LaTeX scanner: finds the spans InlineTeX renders in place.
 * No VS Code dependency, so it is unit-testable in plain Node.
 * Offsets are UTF-16 indices into the source string, end-exclusive.
 */

import { scanGraphics, scanHref, scanInline, scanTextcolor, scanUrl } from './commands';
import type { TextMacros } from './macros';
import { itemLabel, LIST_ENVS, parseListOptions, type ListKind, type ListLevel } from './lists';
import {
  findClose,
  matchBracket,
  readCommand,
  readEnvName,
  readGroup,
  readOptional,
  skipComment,
  skipOptional,
  skipVerb,
} from './syntax';
import { tabularToArray } from './table';
import type { Step, Token } from './tokens';

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

/** Per-scan state shared by the sub-scanners. */
interface ScanState {
  footnotes: number;
  /** Open list environments, outermost first. */
  lists: ListLevel[];
  /** Last counter of each closed enumerate, by nesting depth, for enumitem's `resume`. */
  lastCounters: Map<number, number>;
  /** User macros the scanner reads as a known command or a fixed text. */
  macros: TextMacros;
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
  const opt = readOptional(src, afterName);
  const optEnd = opt?.next ?? afterName;
  const parsed = opt ? parseListOptions(kind, src.slice(opt.start, opt.end)) : {};
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
  const name = readCommand(src, i);
  if (name === '') {
    // Control symbol such as \$, \%, \\ : skip both characters.
    return { next: i + 2 };
  }
  const afterCmd = i + 1 + name.length;
  const macro = Object.hasOwn(state.macros, name) ? state.macros[name] : undefined;
  if (macro && 'text' in macro) {
    const end = src.startsWith('{}', afterCmd) ? afterCmd + 2 : afterCmd;
    return { token: { type: 'symbol', start: i, end, text: macro.text, style: 'symbol' }, next: end };
  }
  // A user macro defined as another command is read as that command.
  const cmd = macro?.command ?? name;
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
  return scanInline(src, i, cmd, afterCmd, state) ?? { next: afterCmd };
}

/**
 * Scan a LaTeX document. Tokens come in source order (by `start`). `macros`
 * are the user macros the text can use (see `textMacros`).
 */
export function scan(src: string, macros: TextMacros = {}): Token[] {
  const tokens: Token[] = [];
  const state: ScanState = { footnotes: 0, lists: [], lastCounters: new Map(), macros };
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
