/**
 * Labels of list items, following LaTeX's defaults and the common forms of
 * the enumitem and enumerate packages. Pure: no VS Code dependency.
 */

export type ListKind = 'itemize' | 'enumerate' | 'description';

export const LIST_ENVS = new Set<string>(['itemize', 'enumerate', 'description']);

/** One open list environment while scanning. */
export interface ListLevel {
  kind: ListKind;
  /** Value of the item counter (enumerate), incremented by each unlabelled \item. */
  counter: number;
  /** Label of an item for counter value `n`; undefined uses the default for the level. */
  format?: (n: number) => string;
}

/** Default itemize marks by nesting level: \textbullet, \textendash, \textasteriskcentered, \textperiodcentered. */
const BULLETS = ['•', '–', '∗', '·'];

function alph(n: number): string {
  let s = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) {
    s = String.fromCodePoint(97 + ((k - 1) % 26)) + s;
  }
  return s;
}

function roman(n: number): string {
  const table: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let s = '';
  let k = n;
  for (const [value, digits] of table) {
    for (; k >= value; k -= value) {
      s += digits;
    }
  }
  return s;
}

const COUNTERS: Record<string, (n: number) => string> = {
  arabic: String,
  alph: alph,
  Alph: (n) => alph(n).toUpperCase(),
  roman: roman,
  Roman: (n) => roman(n).toUpperCase(),
};

/** Default enumerate labels by nesting level: 1. (a) i. A. */
const NUMBERINGS: ((n: number) => string)[] = [
  (n) => `${n}.`,
  (n) => `(${alph(n)})`,
  (n) => `${roman(n)}.`,
  (n) => `${alph(n).toUpperCase()}.`,
];

/** Symbols commonly used as itemize labels. */
const LABEL_SYMBOLS: Record<string, string> = {
  '\\textbullet': '•',
  '\\textendash': '–',
  '\\textemdash': '—',
  '\\textasteriskcentered': '∗',
  '\\textperiodcentered': '·',
  '$\\bullet$': '•',
  '$\\circ$': '∘',
  '$\\star$': '⋆',
  '$\\ast$': '∗',
  '$\\cdot$': '·',
  '$-$': '−',
  '$\\diamond$': '⋄',
  '$\\triangleright$': '▹',
  '$\\rightarrow$': '→',
  '$\\to$': '→',
  '---': '—',
  '--': '–',
};

/** Label of the next item of `level`, nested at `depth` (1-based) among lists of its kind. */
export function itemLabel(level: ListLevel | undefined, depth: number): string {
  if (!level) {
    return BULLETS[0];
  }
  if (level.kind === 'description') {
    return '';
  }
  if (level.kind === 'itemize') {
    return level.format?.(0) ?? BULLETS[Math.min(depth, BULLETS.length) - 1];
  }
  return (level.format ?? NUMBERINGS[Math.min(depth, NUMBERINGS.length) - 1])(level.counter);
}

/**
 * An enumitem label (`\alph*)`, `\textbf{\arabic*.}`) as a function of the
 * counter, or undefined when it uses commands we cannot reproduce.
 */
export function enumitemLabel(template: string): ((n: number) => string) | undefined {
  let text = template.trim();
  const symbol = LABEL_SYMBOLS[text];
  if (symbol) {
    return () => symbol;
  }
  // Formatting wrappers do not change the characters shown.
  text = text.replaceAll(/\\(textbf|textit|emph|textup|textrm|textsf|texttt)\s*(?=\{)/g, '');
  const parts = text.split(/(\\(?:arabic|alph|Alph|roman|Roman)\*)/);
  const pieces: (string | ((n: number) => string))[] = [];
  for (const part of parts) {
    const counter = /^\\(\w+)\*$/.exec(part);
    if (counter) {
      pieces.push(COUNTERS[counter[1]]);
    } else {
      const literal = part.replaceAll(/[{}]/g, '').replaceAll('~', ' ').replaceAll('--', '–');
      if (literal.includes('\\') || literal.includes('$')) {
        return undefined;
      }
      pieces.push(literal);
    }
  }
  return (n) => pieces.map((p) => (typeof p === 'string' ? p : p(n))).join('');
}

/**
 * A label in the syntax of the enumerate package, `[(a)]` or `[I.]`: the
 * first of 1, a, A, i, I outside braces is the counter, the rest is literal.
 */
export function enumeratePackageLabel(template: string): ((n: number) => string) | undefined {
  const marks: Record<string, (n: number) => string> = {
    '1': COUNTERS.arabic,
    a: COUNTERS.alph,
    A: COUNTERS.Alph,
    i: COUNTERS.roman,
    I: COUNTERS.Roman,
  };
  let depth = 0;
  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
    } else if (depth === 0 && marks[c]) {
      const before = template.slice(0, i).replaceAll(/[{}]/g, '');
      const after = template.slice(i + 1).replaceAll(/[{}]/g, '');
      if (`${before}${after}`.includes('\\')) {
        return undefined;
      }
      const counter = marks[c];
      return (n) => `${before}${counter(n)}${after}`;
    }
  }
  return undefined;
}

/** Options of a list environment (its `[...]` argument) that change labels or numbering. */
export interface ListOptions {
  format?: (n: number) => string;
  /** enumitem `start=N`. */
  start?: number;
  /** enumitem `resume`: continue the numbering of the previous list at this level. */
  resume?: boolean;
}

/** Split `key=value` options on commas outside braces. */
function splitOptions(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '{') {
      depth++;
    } else if (src[i] === '}') {
      depth--;
    } else if (src[i] === ',' && depth === 0) {
      out.push(src.slice(start, i));
      start = i + 1;
    }
  }
  out.push(src.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

export function parseListOptions(kind: ListKind, options: string): ListOptions {
  const text = options.trim();
  if (!text.includes('=') && !/^resume\*?$/.test(text)) {
    // enumerate package syntax for enumerate, a plain label otherwise.
    return { format: kind === 'enumerate' ? enumeratePackageLabel(text) : enumitemLabel(text) };
  }
  const result: ListOptions = {};
  for (const option of splitOptions(text)) {
    const [key, ...rest] = option.split('=');
    const value = rest.join('=').trim().replace(/^\{([\s\S]*)\}$/, '$1');
    switch (key.trim()) {
      case 'label':
        result.format = enumitemLabel(value);
        break;
      case 'start':
        result.start = Number.parseInt(value, 10);
        break;
      case 'resume':
      case 'resume*':
        result.resume = true;
        break;
    }
  }
  return result;
}
