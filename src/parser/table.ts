/**
 * Turn a LaTeX `tabular` into a MathJax `array`: same column spec and rules,
 * each cell wrapped in `\text{...}` so that it is set as text (inline `$...$`,
 * \textbf and friends keep working inside it).
 *
 * MathJax's array only knows `\hline` and `\hdashline`, so the rest is
 * approximated: paragraph columns (`p{}`, `m{}`, `b{}`) and tabularx `X` become
 * `l` (long cells do not wrap); partial rules (`\cline`, `\cmidrule`) and
 * booktabs rules become `\hline`; `\multicolumn{n}` puts its text in the
 * first cell followed by n - 1 empty ones; `\multirow` keeps only its text.
 */
import { matchBrace, stripComments } from './syntax';

/**
 * Commands that draw a rule (or, for `\addlinespace`, only add space); they must
 * stay outside `\text`, at the start of a row.
 */
const RULES: { re: RegExp; hline: boolean }[] = [
  { re: /^\\(?:hline|toprule|midrule|bottomrule)/, hline: true },
  { re: /^\\cline\s*\{[^}]*\}/, hline: true },
  { re: /^\\cmidrule\s*(?:\([^)]*\)\s*)?\{[^}]*\}/, hline: true },
  { re: /^\\addlinespace(?:\s*\[[^\]]*\])?/, hline: false },
];

/** The rule command at the start of `src`: its length and whether it draws a line. */
function leadingRule(src: string): { length: number; hline: boolean } | undefined {
  for (const { re, hline } of RULES) {
    const m = re.exec(src);
    if (m) {
      return { length: m[0].length, hline };
    }
  }
  return undefined;
}

/** Read a `{...}` group at `i`: its content and the index after it. */
function group(src: string, i: number): { value: string; end: number } | undefined {
  if (src[i] !== '{') {
    return undefined;
  }
  const close = matchBrace(src, i);
  return close === -1 ? undefined : { value: src.slice(i + 1, close), end: close + 1 };
}

/** Rewrite a column spec into one MathJax accepts. */
export function convertColumnSpec(spec: string): string {
  let out = '';
  let i = 0;
  while (i < spec.length) {
    const column = convertSpecifier(spec, i);
    if (!column) {
      return out + spec.slice(i);
    }
    out += column.text;
    i = column.end;
  }
  return out;
}

/** A converted column specifier: its MathJax text and the index after it. */
interface Specifier {
  text: string;
  end: number;
}

/** Convert the specifier at `i`; undefined when it is malformed and the rest must be kept as is. */
function convertSpecifier(spec: string, i: number): Specifier | undefined {
  const c = spec[i];
  if ('@!<>'.includes(c)) {
    return insertedMaterial(spec, i);
  }
  if (c === '*') {
    return repeatedColumns(spec, i);
  }
  if ('pmb'.includes(c)) {
    return paragraphColumn(spec, i);
  }
  return { text: c === 'X' ? 'l' : c, end: i + 1 };
}

/** `@{}`, `!{}`, `>{}`, `<{}`: material inserted between or around columns, kept verbatim. */
function insertedMaterial(spec: string, i: number): Specifier {
  const g = group(spec, i + 1);
  return g ? { text: spec.slice(i, g.end), end: g.end } : { text: spec[i], end: i + 1 };
}

/** `*{n}{cols}`: the repeated columns are converted too; undefined if a group is missing. */
function repeatedColumns(spec: string, i: number): Specifier | undefined {
  const count = group(spec, i + 1);
  const body = count && group(spec, count.end);
  if (!count || !body) {
    return undefined;
  }
  return { text: `*{${count.value}}{${convertColumnSpec(body.value)}}`, end: body.end };
}

/** `p{}`, `m{}`, `b{}`: paragraph columns become `l`, their width is dropped. */
function paragraphColumn(spec: string, i: number): Specifier {
  const g = group(spec, i + 1);
  return { text: 'l', end: g ? g.end : i + 1 };
}

/** Split `src` on a top-level separator: outside braces, not escaped. */
function splitTopLevel(src: string, isSeparator: (src: string, i: number) => number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
    } else if (depth === 0) {
      const sep = isSeparator(src, i);
      if (sep > 0) {
        parts.push(src.slice(start, i));
        i += sep;
        start = i;
        continue;
      }
    }
    i += c === '\\' && src[i + 1] !== '\\' ? 2 : 1;
  }
  parts.push(src.slice(start));
  return parts;
}

/**
 * Length of a row break at `i`: `\\` or `\tabularnewline`, with an optional
 * `[2pt]` spacing; 0 if there is none.
 */
function rowBreak(src: string, i: number): number {
  let n = 0;
  if (src.startsWith(String.raw`\tabularnewline`, i)) {
    n = String.raw`\tabularnewline`.length;
  } else if (src.startsWith('\\\\', i)) {
    n = 2;
  }
  const space = n > 0 ? /^\s*\[[^\]]*\]/.exec(src.slice(i + n)) : null;
  return n + (space ? space[0].length : 0);
}

/** Wrap one cell's text, leaving \multicolumn and \multirow structure in place. */
function convertCell(cell: string): string {
  const text = cell.trim();
  if (text === '') {
    return '';
  }
  const multi = /^\\(multicolumn|multirow)\s*/.exec(text);
  if (multi) {
    const a = group(text, multi[0].length);
    const b = a && group(text, a.end);
    const c = b && group(text, b.end);
    if (a && b && c) {
      const inner = convertCell(c.value + text.slice(c.end));
      const span = multi[1] === 'multicolumn' ? Math.max(1, Number.parseInt(a.value, 10) || 1) : 1;
      return [inner, ...new Array<string>(span - 1).fill('')].join(' & ');
    }
  }
  return `\\text{${text}}`;
}

/** Convert one row: leading rules stay outside, cells are wrapped. */
function convertRow(row: string): string {
  let rest = row.trimStart();
  let rules = '';
  for (let rule = leadingRule(rest); rule; rule = leadingRule(rest)) {
    rules += rule.hline ? String.raw`\hline ` : '';
    rest = rest.slice(rule.length).trimStart();
  }
  const cells = splitTopLevel(rest, (s, i) => (s[i] === '&' && s[i - 1] !== '\\' ? 1 : 0));
  const body = cells.length === 1 && cells[0].trim() === '' ? '' : cells.map(convertCell).join(' & ');
  return rules + body;
}

/** MathJax source for a tabular with column spec `spec` and body `body`. */
export function tabularToArray(spec: string, body: string): string {
  const rows = splitTopLevel(stripComments(body), rowBreak).map(convertRow);
  // A trailing row break leaves an empty last row: MathJax would draw it.
  if (rows.length > 1 && rows.at(-1)?.trim() === '') {
    rows.pop();
  }
  return `\\begin{array}{${convertColumnSpec(spec)}}\n${rows.join(' \\\\\n')}\n\\end{array}`;
}
