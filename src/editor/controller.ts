import * as vscode from 'vscode';
import { scan, type FormatKind, type FormatToken, type MathToken, type SymbolToken, type Token } from '../parser/scan';
import { collectMacros, type MacroTable } from '../parser/macros';
import { renderMath, resizeSvg, setMacros, svgToDataUri, type RenderedMath } from '../render/mathjax';
import { exPx, layoutImage, resolveLineHeight, type EditorMetrics } from './layout';

interface Settings {
  enabled: boolean;
  languages: string[];
  renderMath: boolean;
  renderFormatting: boolean;
  revealOn: 'cursor' | 'line';
  scale: number;
  color: string;
}

interface ParsedDoc {
  version: number;
  tokens: Token[];
  macros: MacroTable;
  macroKey: string;
}

const HIDE = 'none; display: none;';

const FORMAT_STYLES: Record<FormatKind, vscode.DecorationRenderOptions> = {
  bold: { fontWeight: 'bold' },
  italic: { fontStyle: 'italic' },
  underline: { textDecoration: 'underline' },
  monospace: { textDecoration: 'none; font-family: var(--vscode-editor-font-family), monospace;' },
  part: heading('1.5em'),
  chapter: heading('1.4em'),
  section: heading('1.3em'),
  subsection: heading('1.15em'),
  subsubsection: heading('1.05em'),
  paragraph: { fontWeight: 'bold' },
};

function heading(size: string): vscode.DecorationRenderOptions {
  return {
    fontWeight: 'bold',
    color: new vscode.ThemeColor('textLink.foreground'),
    textDecoration: `none; font-size: ${size};`,
  };
}

export class InlineTexController implements vscode.Disposable {
  private readonly hideType = vscode.window.createTextEditorDecorationType({ textDecoration: HIDE });
  private readonly mathType = vscode.window.createTextEditorDecorationType({});
  private readonly symbolType = vscode.window.createTextEditorDecorationType({});
  private readonly errorType = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline wavy',
    color: new vscode.ThemeColor('editorError.foreground'),
  });
  private readonly formatTypes = new Map<FormatKind, vscode.TextEditorDecorationType>(
    (Object.keys(FORMAT_STYLES) as FormatKind[]).map((k) => [
      k,
      vscode.window.createTextEditorDecorationType(FORMAT_STYLES[k]),
    ]),
  );

  private readonly parsed = new Map<string, ParsedDoc>();
  private readonly svgCache = new Map<string, RenderedMath>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timers = new Map<vscode.TextEditor, ReturnType<typeof setTimeout>>();
  private settings = readSettings();

  constructor() {
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshAll()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateContext()),
      vscode.window.onDidChangeTextEditorSelection((e) => this.schedule(e.textEditor, 0)),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => this.schedule(e.textEditor, 50)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        for (const ed of vscode.window.visibleTextEditors) {
          if (ed.document === e.document) {
            this.schedule(ed, 150);
          }
        }
      }),
      vscode.workspace.onDidCloseTextDocument((d) => this.parsed.delete(d.uri.toString())),
      vscode.window.onDidChangeActiveColorTheme(() => this.refreshAll()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('inlineTeX') || e.affectsConfiguration('editor')) {
          this.settings = readSettings();
          this.refreshAll();
        }
      }),
      vscode.languages.registerHoverProvider({ scheme: '*' }, { provideHover: (d, p) => this.hover(d, p) }),
    );
    this.refreshAll();
  }

  refreshAll(): void {
    this.updateContext();
    for (const ed of vscode.window.visibleTextEditors) {
      this.update(ed);
    }
  }

  /** Context key scoping the toggle keybinding to the configured languages. */
  private updateContext(): void {
    const doc = vscode.window.activeTextEditor?.document;
    const active = !!doc && this.settings.languages.includes(doc.languageId);
    void vscode.commands.executeCommand('setContext', 'inlineTeX.languageActive', active);
  }

  private schedule(editor: vscode.TextEditor, delay: number): void {
    clearTimeout(this.timers.get(editor));
    this.timers.set(
      editor,
      setTimeout(() => {
        this.timers.delete(editor);
        this.update(editor);
      }, delay),
    );
  }

  private applies(doc: vscode.TextDocument): boolean {
    return this.settings.enabled && this.settings.languages.includes(doc.languageId);
  }

  private parse(doc: vscode.TextDocument): ParsedDoc {
    const key = doc.uri.toString();
    const cached = this.parsed.get(key);
    if (cached?.version === doc.version) {
      return cached;
    }
    const text = doc.getText();
    const macros = collectMacros(text);
    const parsed = { version: doc.version, tokens: scan(text), macros, macroKey: JSON.stringify(macros) };
    this.parsed.set(key, parsed);
    return parsed;
  }

  private metrics(doc: vscode.TextDocument): EditorMetrics {
    const cfg = vscode.workspace.getConfiguration('editor', doc);
    const fontSize = cfg.get<number>('fontSize', 14);
    const lineHeight = cfg.get<number>('lineHeight', 0);
    return {
      fontSizePx: fontSize,
      lineHeightPx: resolveLineHeight(fontSize, lineHeight, process.platform === 'darwin'),
      scale: this.settings.scale,
    };
  }

  private mathColor(): string {
    if (this.settings.color) {
      return this.settings.color;
    }
    const kind = vscode.window.activeColorTheme.kind;
    return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
      ? '#1f1f1f'
      : '#d4d4d4';
  }

  private render(token: MathToken, m: EditorMetrics, parsed: ParsedDoc): RenderedMath {
    const color = this.mathColor();
    const ex = exPx(m);
    const key = `${token.display ? 'D' : 'I'}|${color}|${ex}|${parsed.macroKey}|${token.tex}`;
    let r = this.svgCache.get(key);
    if (!r) {
      setMacros(parsed.macros);
      r = renderMath(token.tex, { color, exPx: ex, display: token.display });
      if (this.svgCache.size > 2000) {
        this.svgCache.clear();
      }
      this.svgCache.set(key, r);
    }
    return r;
  }

  private isRevealed(range: vscode.Range, selections: readonly vscode.Selection[]): boolean {
    return selections.some((s) => {
      if (this.settings.revealOn === 'line') {
        return s.start.line <= range.end.line && s.end.line >= range.start.line;
      }
      return s.start.isBeforeOrEqual(range.end) && s.end.isAfterOrEqual(range.start);
    });
  }

  private clear(editor: vscode.TextEditor): void {
    for (const t of [this.hideType, this.mathType, this.symbolType, this.errorType, ...this.formatTypes.values()]) {
      editor.setDecorations(t, []);
    }
  }

  private update(editor: vscode.TextEditor): void {
    const doc = editor.document;
    if (!this.applies(doc)) {
      this.clear(editor);
      return;
    }
    const ctx: PassContext = {
      doc,
      parsed: this.parse(doc),
      metrics: this.metrics(doc),
      visible: editor.visibleRanges.map(
        (r) => new vscode.Range(Math.max(0, r.start.line - 30), 0, r.end.line + 30, 0),
      ),
      out: { hide: [], math: [], symbols: [], errors: [], formats: new Map() },
    };
    for (const t of ctx.parsed.tokens) {
      const range = new vscode.Range(doc.positionAt(t.start), doc.positionAt(t.end));
      if (this.isRevealed(range, editor.selections)) {
        continue;
      }
      if (t.type === 'math') {
        this.decorateMath(t, range, ctx);
      } else if (this.settings.renderFormatting) {
        decorateText(t, range, ctx);
      }
    }
    const { out } = ctx;
    editor.setDecorations(this.hideType, out.hide);
    editor.setDecorations(this.mathType, out.math);
    editor.setDecorations(this.symbolType, out.symbols);
    editor.setDecorations(this.errorType, out.errors);
    for (const [kind, type] of this.formatTypes) {
      editor.setDecorations(type, out.formats.get(kind) ?? []);
    }
  }

  private decorateMath(t: MathToken, range: vscode.Range, ctx: PassContext): void {
    if (!this.settings.renderMath || !ctx.visible.some((v) => v.intersection(range))) {
      return;
    }
    const r = this.render(t, ctx.metrics, ctx.parsed);
    if (r.error) {
      ctx.out.errors.push({ range, hoverMessage: `InlineTeX : ${r.error}` });
      return;
    }
    let span = range.end.line - range.start.line + 1;
    if (t.display) {
      span += blankLinesAfter(ctx.doc, range.end.line, 3);
    }
    const box = layoutImage(r, t.display, span, ctx.metrics);
    ctx.out.hide.push(range);
    ctx.out.math.push({
      range: new vscode.Range(range.start, range.start),
      renderOptions: {
        before: {
          contentIconPath: vscode.Uri.parse(svgToDataUri(resizeSvg(r.svg, box.widthPx, box.heightPx))),
          width: `${box.widthPx.toFixed(2)}px`,
          height: `${box.heightPx.toFixed(2)}px`,
          textDecoration: `none; vertical-align: ${box.verticalAlign};`,
        },
      },
    });
  }

  private hover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    if (!this.applies(doc) || !this.settings.renderMath) {
      return undefined;
    }
    const offset = doc.offsetAt(pos);
    const parsed = this.parse(doc);
    const t = parsed.tokens.find((x): x is MathToken => x.type === 'math' && x.start <= offset && offset < x.end);
    if (!t) {
      return undefined;
    }
    const m = this.metrics(doc);
    const r = this.render(t, { ...m, scale: m.scale * 1.4 }, parsed);
    const md = new vscode.MarkdownString();
    if (r.error) {
      md.appendMarkdown(`**InlineTeX** : ${r.error}`);
    } else {
      md.appendMarkdown(`![formule](${svgToDataUri(r.svg)})`);
    }
    return new vscode.Hover(md, new vscode.Range(doc.positionAt(t.start), doc.positionAt(t.end)));
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    for (const t of [this.hideType, this.mathType, this.symbolType, this.errorType, ...this.formatTypes.values()]) {
      t.dispose();
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

interface PassContext {
  doc: vscode.TextDocument;
  parsed: ParsedDoc;
  metrics: EditorMetrics;
  visible: vscode.Range[];
  out: {
    hide: vscode.Range[];
    math: vscode.DecorationOptions[];
    symbols: vscode.DecorationOptions[];
    errors: vscode.DecorationOptions[];
    formats: Map<FormatKind, vscode.Range[]>;
  };
}

/** Formatting commands and symbols: hide the markup, style or replace what remains. */
function decorateText(t: FormatToken | SymbolToken, range: vscode.Range, ctx: PassContext): void {
  const { doc, out } = ctx;
  if (t.type === 'symbol') {
    out.hide.push(range);
    out.symbols.push({
      range: new vscode.Range(range.start, range.start),
      renderOptions: { before: { contentText: t.text, color: new vscode.ThemeColor('textLink.foreground') } },
    });
    return;
  }
  const argStart = doc.positionAt(t.argStart);
  const argEnd = doc.positionAt(t.argEnd);
  out.hide.push(new vscode.Range(range.start, argStart), new vscode.Range(argEnd, range.end));
  const list = out.formats.get(t.kind) ?? [];
  list.push(new vscode.Range(argStart, argEnd));
  out.formats.set(t.kind, list);
}

/** Blank lines right after `line`: display math may draw over them. */
function blankLinesAfter(doc: vscode.TextDocument, line: number, max: number): number {
  let n = 0;
  while (n < max && line + n + 1 < doc.lineCount && doc.lineAt(line + n + 1).isEmptyOrWhitespace) {
    n++;
  }
  return n;
}

function readSettings(): Settings {
  const c = vscode.workspace.getConfiguration('inlineTeX');
  return {
    enabled: c.get('enabled', true),
    languages: c.get('languages', ['latex', 'tex']),
    renderMath: c.get('renderMath', true),
    renderFormatting: c.get('renderFormatting', true),
    revealOn: c.get('revealOn', 'cursor'),
    scale: c.get('scale', 1),
    color: c.get('color', ''),
  };
}
