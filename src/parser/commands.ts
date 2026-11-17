/**
 * Inline commands: formatting, colors, links, pictures, and commands drawn as
 * a short text (symbols, references, citations, labels, footnotes).
 */

import { readGroup, readOptional, skipOptional } from './syntax';
import type { FormatKind, Step } from './tokens';

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
export function scanTextcolor(src: string, i: number, afterCmd: number): Step {
  const opt = readOptional(src, afterCmd);
  const model = opt && src.slice(opt.start, opt.end).trim();
  const spec = readGroup(src, opt?.next ?? afterCmd);
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
export function scanHref(src: string, i: number, afterCmd: number): Step {
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
export function scanUrl(src: string, i: number, afterCmd: number): Step {
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

/**
 * Commands replaced by a short text: references, citations, labels and
 * footnotes. Their argument is not scanned further.
 */
function scanReplaced(src: string, i: number, cmd: string, afterCmd: number, state: { footnotes: number }): Step | undefined {
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
export function scanGraphics(src: string, i: number, afterCmd: number): Step {
  let at = afterCmd + (src[afterCmd] === '*' ? 1 : 0);
  at = skipOptional(src, at);
  const arg = readGroup(src, at);
  if (!arg) {
    return { next: afterCmd };
  }
  return { token: { type: 'image', start: i, end: arg.next, path: src.slice(arg.start, arg.end).trim() }, next: arg.next };
}

/** A command drawn as a short text, or a formatting command; undefined for any other. */
export function scanInline(
  src: string,
  i: number,
  cmd: string,
  afterCmd: number,
  state: { footnotes: number },
): Step | undefined {
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
    return undefined;
  }
  const end = src.startsWith('{}', afterCmd) ? afterCmd + 2 : afterCmd;
  return { token: { type: 'symbol', start: i, end, text: symbol, style: 'symbol' }, next: end };
}
