/** Tokens produced by the LaTeX and Markdown scanners. Offsets are UTF-16 indices, end-exclusive. */

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

/** Result of a sub-scanner: an optional token and where to resume. */
export interface Step {
  token?: Token;
  next: number;
}
