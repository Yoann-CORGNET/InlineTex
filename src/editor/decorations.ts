import * as vscode from 'vscode';
import type { FormatKind, FormatToken, SymbolToken, Token } from '../parser/tokens';

const HIDE = 'none; display: none;';

const FORMAT_STYLES: Record<Exclude<FormatKind, 'color'>, vscode.DecorationRenderOptions> = {
  bold: { fontWeight: 'bold' },
  italic: { fontStyle: 'italic' },
  underline: { textDecoration: 'underline' },
  monospace: { textDecoration: 'none; font-family: var(--vscode-editor-font-family), monospace;' },
  link: { textDecoration: 'underline', color: new vscode.ThemeColor('textLink.foreground') },
  part: heading('1.5em'),
  chapter: heading('1.4em'),
  section: heading('1.3em'),
  subsection: heading('1.15em'),
  subsubsection: heading('1.05em'),
  paragraph: { fontWeight: 'bold' },
  muted: { opacity: '0.45' },
};

const SYMBOL_STYLES: Record<SymbolToken['style'], vscode.ThemableDecorationAttachmentRenderOptions> = {
  symbol: { color: new vscode.ThemeColor('textLink.foreground') },
  ref: { color: new vscode.ThemeColor('textLink.foreground'), textDecoration: 'underline dotted' },
  label: { color: new vscode.ThemeColor('descriptionForeground'), fontStyle: 'italic' },
  note: { color: new vscode.ThemeColor('textLink.foreground') },
};

function heading(size: string): vscode.DecorationRenderOptions {
  return {
    fontWeight: 'bold',
    color: new vscode.ThemeColor('textLink.foreground'),
    textDecoration: `none; font-size: ${size};`,
  };
}

/** Decorations gathered in one pass over an editor, applied together. */
export interface DecorationSet {
  hide: vscode.Range[];
  images: vscode.DecorationOptions[];
  symbols: vscode.DecorationOptions[];
  formats: Map<FormatKind, vscode.Range[]>;
  colors: Map<string, vscode.Range[]>;
}

export function emptyDecorationSet(): DecorationSet {
  return { hide: [], images: [], symbols: [], formats: new Map(), colors: new Map() };
}

/** The decoration types of the extension, shared by every editor. */
export class DecorationTypes implements vscode.Disposable {
  private readonly hide = vscode.window.createTextEditorDecorationType({ textDecoration: HIDE });
  private readonly image = vscode.window.createTextEditorDecorationType({});
  private readonly symbol = vscode.window.createTextEditorDecorationType({});
  private readonly formats = new Map<FormatKind, vscode.TextEditorDecorationType>(
    (Object.keys(FORMAT_STYLES) as (keyof typeof FORMAT_STYLES)[]).map((k) => [
      k,
      vscode.window.createTextEditorDecorationType(FORMAT_STYLES[k]),
    ]),
  );
  /** One decoration type per \textcolor color met so far. */
  private readonly colors = new Map<string, vscode.TextEditorDecorationType>();

  apply(editor: vscode.TextEditor, set: DecorationSet): void {
    editor.setDecorations(this.hide, set.hide);
    editor.setDecorations(this.image, set.images);
    editor.setDecorations(this.symbol, set.symbols);
    for (const [kind, type] of this.formats) {
      editor.setDecorations(type, set.formats.get(kind) ?? []);
    }
    for (const color of set.colors.keys()) {
      if (!this.colors.has(color)) {
        this.colors.set(color, vscode.window.createTextEditorDecorationType({ color }));
      }
    }
    for (const [color, type] of this.colors) {
      editor.setDecorations(type, set.colors.get(color) ?? []);
    }
  }

  clear(editor: vscode.TextEditor): void {
    for (const t of this.all()) {
      editor.setDecorations(t, []);
    }
  }

  dispose(): void {
    for (const t of this.all()) {
      t.dispose();
    }
  }

  private all(): vscode.TextEditorDecorationType[] {
    return [this.hide, this.image, this.symbol, ...this.formats.values(), ...this.colors.values()];
  }
}

export function tokenRange(doc: vscode.TextDocument, t: Token): vscode.Range {
  return new vscode.Range(doc.positionAt(t.start), doc.positionAt(t.end));
}

/** Hide the token's source and draw `uri` (an SVG of the given box) in its place. */
export function pushImage(
  set: DecorationSet,
  doc: vscode.TextDocument,
  t: Token,
  uri: vscode.Uri,
  box: { widthPx: number; heightPx: number; verticalAlign: string },
): void {
  const range = tokenRange(doc, t);
  set.hide.push(range);
  set.images.push({
    range: new vscode.Range(range.start, range.start),
    renderOptions: {
      before: {
        contentIconPath: uri,
        width: `${box.widthPx.toFixed(2)}px`,
        height: `${box.heightPx.toFixed(2)}px`,
        textDecoration: `none; vertical-align: ${box.verticalAlign};`,
      },
    },
  });
}

/** Formatting commands and symbols: hide the markup, style or replace what remains. */
export function pushText(set: DecorationSet, doc: vscode.TextDocument, t: FormatToken | SymbolToken): void {
  const range = tokenRange(doc, t);
  if (t.type === 'symbol') {
    set.hide.push(range);
    set.symbols.push({
      range: new vscode.Range(range.start, range.start),
      renderOptions: { before: { contentText: t.text, ...SYMBOL_STYLES[t.style] } },
    });
    return;
  }
  const argStart = doc.positionAt(t.argStart);
  const argEnd = doc.positionAt(t.argEnd);
  // Muted spans hide nothing: their markup ranges are empty.
  for (const hidden of [new vscode.Range(range.start, argStart), new vscode.Range(argEnd, range.end)]) {
    if (!hidden.isEmpty) {
      set.hide.push(hidden);
    }
  }
  const arg = new vscode.Range(argStart, argEnd);
  if (t.kind === 'color' && t.color) {
    pushRange(set.colors, t.color, arg);
  } else {
    pushRange(set.formats, t.kind, arg);
  }
}

function pushRange<K>(map: Map<K, vscode.Range[]>, key: K, range: vscode.Range): void {
  const list = map.get(key);
  if (list) {
    list.push(range);
  } else {
    map.set(key, [range]);
  }
}
