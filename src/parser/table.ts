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
import { matchBrace } from './scan';

/** Commands that draw a rule; they must stay outside `\text`, at the start of a row. */
const RULES = /^\\(hline|toprule|midrule|bottomrule|cline\s*\{[^}]*\}|cmidrule\s*(?:\([^)]*\))?\s*\{[^}]*\}|addlinespace(?:\s*\[[^\]]*\])?)\s*/;

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
    const c = spec[i];
    if ('@!<>'.includes(c)) {
      // Material inserted between or around columns: kept verbatim.
      const g = group(spec, i + 1);
      out += g ? c + spec.slice(i + 1, g.end) : c;
      i = g ? g.end : i + 1;
    } else if (c === '*') {
      const count = group(spec, i + 1);
      const body = count && group(spec, count.end);
      if (!count || !body) {
        return out + spec.slice(i);
      }
      out += `*{${count.value}}{${convertColumnSpec(body.value)}}`;
      i = body.end;
    } else if ('pmb'.includes(c)) {
      const g = group(spec, i + 1);
      out += 'l';
      i = g ? g.end : i + 1;
    } else if (c === 'X') {
      out += 'l';
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Remove `%` comments (an escaped `\%` is text). */
function stripComments(src: string): string {
  return src.replaceAll(/(^|[^\\])%.*$/gm, '$1');
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
  for (let m = RULES.exec(rest); m; m = RULES.exec(rest)) {
    rules += m[1].startsWith('addlinespace') ? '' : '\\hline ';
    rest = rest.slice(m[0].length);
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
