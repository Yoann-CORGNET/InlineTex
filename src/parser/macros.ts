import { matchBrace } from './syntax';

export type MacroTable = Record<string, string | [string, number]>;

/** Read `{...}` or a bare control sequence at `i` (after optional spaces). */
function readArg(src: string, i: number): { value: string; end: number } | undefined {
  while (src[i] === ' ' || src[i] === '\t') {
    i++;
  }
  if (src[i] === '{') {
    const close = matchBrace(src, i);
    return close === -1 ? undefined : { value: src.slice(i + 1, close), end: close + 1 };
  }
  const m = /^\\[A-Za-z]+/.exec(src.slice(i, i + 64));
  return m ? { value: m[0], end: i + m[0].length } : undefined;
}

type Definition = [name: string, value: string | [string, number]];

/** \def\name#1#2{body} */
function parseDef(src: string, i: number): Definition | undefined {
  const name = /^\s*\\([A-Za-z]+)((?:#\d)*)/.exec(src.slice(i, i + 80));
  const body = name ? readArg(src, i + name[0].length) : undefined;
  if (!name || !body) {
    return undefined;
  }
  const argc = name[2].length / 2;
  return [name[1], argc > 0 ? [body.value, argc] : body.value];
}

/** \DeclareMathOperator{\name}{text}, starred variant puts limits below. */
function parseOperator(src: string, i: number, star: boolean): Definition | undefined {
  const name = readArg(src, i);
  const body = name?.value.startsWith('\\') ? readArg(src, name.end) : undefined;
  if (!name || !body) {
    return undefined;
  }
  const op = star ? String.raw`\operatorname*` : String.raw`\operatorname`;
  return [name.value.slice(1), `${op}{${body.value}}`];
}

/** \newcommand{\name}[argc][default]{body} and friends. */
function parseNewcommand(src: string, i: number): Definition | undefined {
  const name = readArg(src, i);
  if (!name?.value.startsWith('\\')) {
    return undefined;
  }
  i = name.end;
  const count = /^\s*\[(\d)\]/.exec(src.slice(i, i + 16));
  const argc = count ? Number(count[1]) : 0;
  if (count) {
    i += count[0].length;
    // MathJax macros have no optional-argument default: skip it.
    const opt = /^\s*\[[^\]]*\]/.exec(src.slice(i, i + 256));
    i += opt ? opt[0].length : 0;
  }
  const body = readArg(src, i);
  if (!body) {
    return undefined;
  }
  return [name.value.slice(1), argc > 0 ? [body.value, argc] : body.value];
}

/**
 * Collect user macro definitions so MathJax renders them like LaTeX would:
 * \newcommand, \renewcommand, \providecommand, \def and \DeclareMathOperator.
 */
export function collectMacros(src: string): MacroTable {
  const macros: MacroTable = {};
  const re = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator|def)(\*?)/g;
  for (const m of src.matchAll(re)) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    if (src.slice(lineStart, m.index).includes('%')) {
      continue;
    }
    const at = m.index + m[0].length;
    let def: Definition | undefined;
    if (m[1] === 'def') {
      def = parseDef(src, at);
    } else if (m[1] === 'DeclareMathOperator') {
      def = parseOperator(src, at, m[2] === '*');
    } else {
      def = parseNewcommand(src, at);
    }
    if (def) {
      macros[def[0]] = def[1];
    }
  }
  return macros;
}

/**
 * How the text scanner reads a user macro: as another command it knows
 * (`\code` defined as `\texttt{#1}`), or as a fixed text drawn in its place.
 */
export type TextMacro = { command: string } | { text: string };
export type TextMacros = Record<string, TextMacro>;

/** Text with no TeX markup: it can be shown as written. */
const PLAIN = /^[^\\{}$%#&^_~]+$/;

/** A text-mode command around a plain text (`\textsc{sat}`); math ones such as `\mathbb{R}` are not text. */
const TEXT_WRAPPER = /^\\(?:text[a-z]+|emph|mbox)\s*\{([^{}]*)\}$/;

/**
 * The macros the text scanner can follow without expanding them: renames of a
 * command (`\newcommand{\code}[1]{\texttt{#1}}`, `\let`-like `\def\x{\y}`),
 * and macros without argument whose body is a plain text, possibly wrapped in a
 * single command (`\newcommand{\SAT}{\textsc{sat}}` shows `sat`). Anything
 * else is left to the source.
 */
export function textMacros(macros: MacroTable): TextMacros {
  const out: TextMacros = {};
  for (const [name, value] of Object.entries(macros)) {
    const [body, argc] = typeof value === 'string' ? [value.trim(), 0] : [value[0].trim(), value[1]];
    if (argc > 1) {
      continue;
    }
    const rename = argc === 1 ? /^\\([A-Za-z]+)\s*\{\s*#1\s*\}$/.exec(body) : /^\\([A-Za-z]+)$/.exec(body);
    if (rename) {
      out[name] = { command: rename[1] };
      continue;
    }
    const text = argc === 0 ? (TEXT_WRAPPER.exec(body)?.[1] ?? body) : '';
    if (PLAIN.test(text)) {
      out[name] = { text };
    }
  }
  return out;
}
