import * as path from 'node:path';
import * as vscode from 'vscode';
import { scan, type FormatKind, type FormatToken, type ImageToken, type MathToken, type SymbolToken, type Token } from '../parser/scan';
import { scanMarkdown } from '../parser/markdown';
import { collectMacros, type MacroTable } from '../parser/macros';
import type * as MathJax from '../render/mathjax';
import type { RenderedMath } from '../render/mathjax';
import { resizeSvg, svgToDataUri } from '../render/svg';
import { IMAGE_EXTENSIONS, framedImageSvg, imageDataUri, imageSize, type ImageSize } from '../render/image';
import { Lru } from '../util/lru';
import { exPx, layoutImage, resolveLineHeight, type EditorMetrics } from './layout';
import { blankLinesAfter, lineAt, lineStarts, linesToOffsets, tokensToDecorate } from './plan';
import { ProjectMacros } from './project';

interface Settings {
  enabled: boolean;
  languages: string[];
  renderMath: boolean;
  renderTables: boolean;
  renderFormatting: boolean;
  renderImages: boolean;
  revealOn: 'cursor' | 'line';
  scale: number;
  color: string;
}

interface ParsedDoc {
  version: number;
  text: string;
  lineStarts: number[];
  tokens: Token[];
  /** Macros of this document, merged over those of the rest of the project. */
  macros: MacroTable;
  macroKey: string;
  ownMacros: MacroTable;
  /** Key of the project macros the merge was made with. */
  externalKey: string;
}

/** Lines kept decorated above and below the viewport, so scrolling does not flash source. */
const VISIBLE_MARGIN = 30;
/** Blank lines after display content that it may draw over. */
const MAX_BLANK_LINES = 3;
/**
 * Larger pictures are not previewed: the data URI (base64 inside an SVG, itself
 * in base64) is sent to the renderer on every pass, cursor moves included.
 */
const MAX_IMAGE_BYTES = 1024 * 1024;

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

/** A picture found for an \includegraphics path. */
interface LoadedImage {
  uri: vscode.Uri;
  dataUri: string;
  size: ImageSize;
}

type MathJaxModule = typeof MathJax;

export class InlineTexController implements vscode.Disposable {
  private readonly hideType = vscode.window.createTextEditorDecorationType({ textDecoration: HIDE });
  private readonly imageType = vscode.window.createTextEditorDecorationType({});
  private readonly symbolType = vscode.window.createTextEditorDecorationType({});
  private readonly formatTypes = new Map<FormatKind, vscode.TextEditorDecorationType>(
    (Object.keys(FORMAT_STYLES) as (keyof typeof FORMAT_STYLES)[]).map((k) => [
      k,
      vscode.window.createTextEditorDecorationType(FORMAT_STYLES[k]),
    ]),
  );
  /** One decoration type per \textcolor color met so far. */
  private readonly colorTypes = new Map<string, vscode.TextEditorDecorationType>();

  private readonly parsed = new Map<string, ParsedDoc>();
  private readonly svgCache = new Lru<string, RenderedMath>(2000);
  private readonly uriCache = new Lru<string, vscode.Uri>(2000);
  private readonly errorCache = new Lru<string, string | null>(5000);
  private readonly images = new Map<string, Promise<LoadedImage | undefined>>();
  private readonly loadedImages = new Map<string, LoadedImage | undefined>();
  /** Documents whose rendering was suspended from the status bar, for this session. */
  private readonly paused = new Set<string>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('InlineTeX');
  private readonly diagnosticTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private readonly project = new ProjectMacros((uri) => this.refreshDocument(uri));
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timers = new Map<vscode.TextEditor, ReturnType<typeof setTimeout>>();
  private settings = readSettings();
  private mathjaxModule: MathJaxModule | undefined;
  private imageTimer: ReturnType<typeof setTimeout> | undefined;

  /** `fontDir` holds the MathJax glyph files built next to the bundle. */
  constructor(private readonly fontDir: string) {
    const imageWatcher = vscode.workspace.createFileSystemWatcher(`**/*{${IMAGE_EXTENSIONS.join(',')}}`);
    // Debounced: a script regenerating plots writes many files in a row.
    const imagesChanged = () => {
      clearTimeout(this.imageTimer);
      this.imageTimer = setTimeout(() => {
        this.images.clear();
        this.loadedImages.clear();
        this.refreshAll();
      }, 300);
    };
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshAll()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateContext()),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        // While typing, the text change already scheduled a debounced pass: a
        // selection event on a document not parsed yet must not bypass it.
        const parsed = this.parsed.get(e.textEditor.document.uri.toString());
        if (!parsed || parsed.version === e.textEditor.document.version) {
          this.schedule(e.textEditor, 0);
        }
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => this.schedule(e.textEditor, 50)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        for (const ed of vscode.window.visibleTextEditors) {
          if (ed.document === e.document) {
            this.schedule(ed, 150);
          }
        }
      }),
      vscode.workspace.onDidCloseTextDocument((d) => {
        const key = d.uri.toString();
        this.parsed.delete(key);
        this.diagnostics.delete(d.uri);
        clearTimeout(this.diagnosticTimers.get(key));
        this.diagnosticTimers.delete(key);
      }),
      vscode.window.onDidChangeActiveColorTheme(() => this.refreshAll()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('inlineTeX') || e.affectsConfiguration('editor')) {
          this.settings = readSettings();
          this.refreshAll();
        }
      }),
      vscode.languages.registerHoverProvider({ scheme: '*' }, { provideHover: (d, p) => this.hover(d, p) }),
      imageWatcher,
      imageWatcher.onDidChange(imagesChanged),
      imageWatcher.onDidCreate(imagesChanged),
      imageWatcher.onDidDelete(imagesChanged),
    );
    this.refreshAll();
  }

  refreshAll(): void {
    this.updateContext();
    for (const ed of vscode.window.visibleTextEditors) {
      this.update(ed);
      this.scheduleDiagnostics(ed.document);
    }
  }

  /** Suspend or resume rendering of the active document for this session. */
  toggleDocument(): void {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc) {
      return;
    }
    const key = doc.uri.toString();
    if (!this.paused.delete(key)) {
      this.paused.add(key);
    }
    this.refreshAll();
  }

  private refreshDocument(uri: vscode.Uri): void {
    const key = uri.toString();
    for (const ed of vscode.window.visibleTextEditors) {
      if (ed.document.uri.toString() === key) {
        this.update(ed);
        this.scheduleDiagnostics(ed.document);
      }
    }
  }

  /** Context key scoping the toggle keybinding to the configured languages, and the status bar item. */
  private updateContext(): void {
    const doc = vscode.window.activeTextEditor?.document;
    const active = !!doc && this.settings.languages.includes(doc.languageId);
    void vscode.commands.executeCommand('setContext', 'inlineTeX.languageActive', active);
    if (!active) {
      this.status.hide();
      return;
    }
    if (!this.settings.enabled) {
      this.status.text = '$(eye-closed) TeX';
      this.status.tooltip = 'InlineTeX est désactivé. Cliquer pour l’activer.';
      this.status.command = 'inlineTeX.toggle';
    } else if (this.paused.has(doc.uri.toString())) {
      this.status.text = '$(eye-closed) TeX';
      this.status.tooltip = 'Rendu suspendu pour ce fichier. Cliquer pour le reprendre.';
      this.status.command = 'inlineTeX.toggleDocument';
    } else {
      this.status.text = '$(eye) TeX';
      this.status.tooltip = 'Rendu actif. Cliquer pour le suspendre dans ce fichier.';
      this.status.command = 'inlineTeX.toggleDocument';
    }
    this.status.show();
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
    return (
      this.settings.enabled &&
      this.settings.languages.includes(doc.languageId) &&
      !this.paused.has(doc.uri.toString())
    );
  }

  /** MathJax is loaded on first use: activation in a language that is never rendered stays cheap. */
  private mathjax(): MathJaxModule {
    if (!this.mathjaxModule) {
      this.mathjaxModule = require('../render/mathjax') as MathJaxModule;
      const fontDir = this.fontDir;
      this.mathjaxModule.setFontLoader((name) => require(path.join(fontDir, `${name}.js`)));
    }
    return this.mathjaxModule;
  }

  private parse(doc: vscode.TextDocument): ParsedDoc {
    const key = doc.uri.toString();
    const markdown = doc.languageId === 'markdown';
    const external = markdown ? { macros: {}, key: '{}' } : this.project.get(doc);
    let parsed = this.parsed.get(key);
    if (parsed?.version === doc.version && parsed.externalKey === external.key) {
      return parsed;
    }
    if (parsed?.version !== doc.version) {
      const text = doc.getText();
      parsed = {
        version: doc.version,
        text,
        lineStarts: lineStarts(text),
        tokens: markdown ? scanMarkdown(text) : scan(text),
        ownMacros: collectMacros(text),
        macros: {},
        macroKey: '',
        externalKey: '',
      };
    }
    parsed.macros = { ...external.macros, ...parsed.ownMacros };
    parsed.macroKey = JSON.stringify(parsed.macros);
    parsed.externalKey = external.key;
    this.parsed.set(key, parsed);
    this.scheduleDiagnostics(doc);
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
    switch (vscode.window.activeColorTheme.kind) {
      case vscode.ColorThemeKind.Light:
        return '#1f1f1f';
      case vscode.ColorThemeKind.HighContrastLight:
        return '#000000';
      case vscode.ColorThemeKind.HighContrast:
        return '#ffffff';
      default:
        return '#d4d4d4';
    }
  }

  /** Formulas and tables share the MathJax pipeline but have their own setting. */
  private rendersMath(t: MathToken): boolean {
    return t.table ? this.settings.renderTables : this.settings.renderMath;
  }

  private renderKey(token: MathToken, m: EditorMetrics, parsed: ParsedDoc): string {
    return `${token.display ? 'D' : 'I'}|${this.mathColor()}|${exPx(m)}|${parsed.macroKey}|${token.tex}`;
  }

  private render(token: MathToken, m: EditorMetrics, parsed: ParsedDoc): RenderedMath {
    const key = this.renderKey(token, m, parsed);
    let r = this.svgCache.get(key);
    if (!r) {
      const opts = { color: this.mathColor(), exPx: exPx(m), display: token.display };
      r = this.mathjax().renderMath(token.tex, opts, parsed.macros, parsed.macroKey);
      this.svgCache.set(key, r);
    }
    return r;
  }

  private clear(editor: vscode.TextEditor): void {
    for (const t of this.allTypes()) {
      editor.setDecorations(t, []);
    }
  }

  private allTypes(): vscode.TextEditorDecorationType[] {
    return [this.hideType, this.imageType, this.symbolType, ...this.formatTypes.values(), ...this.colorTypes.values()];
  }

  private update(editor: vscode.TextEditor): void {
    const doc = editor.document;
    if (!this.applies(doc)) {
      this.clear(editor);
      return;
    }
    const parsed = this.parse(doc);
    const ctx: PassContext = {
      doc,
      parsed,
      metrics: this.metrics(doc),
      out: { hide: [], images: [], symbols: [], formats: new Map(), colors: new Map() },
    };
    const tokens = tokensToDecorate({
      tokens: parsed.tokens,
      lineStarts: parsed.lineStarts,
      visible: editor.visibleRanges.map((r) =>
        linesToOffsets(parsed.lineStarts, parsed.text.length, r.start.line, r.end.line, VISIBLE_MARGIN),
      ),
      selections: editor.selections.map((s) => ({ start: doc.offsetAt(s.start), end: doc.offsetAt(s.end) })),
      revealOn: this.settings.revealOn,
    });
    for (const t of tokens) {
      if (t.type === 'math') {
        this.decorateMath(t, ctx);
      } else if (t.type === 'image') {
        this.decorateImage(t, ctx);
      } else if (this.settings.renderFormatting) {
        decorateText(t, ctx);
      }
    }
    this.apply(editor, ctx.out);
  }

  private apply(editor: vscode.TextEditor, out: PassContext['out']): void {
    editor.setDecorations(this.hideType, out.hide);
    editor.setDecorations(this.imageType, out.images);
    editor.setDecorations(this.symbolType, out.symbols);
    for (const [kind, type] of this.formatTypes) {
      editor.setDecorations(type, out.formats.get(kind) ?? []);
    }
    for (const color of out.colors.keys()) {
      if (!this.colorTypes.has(color)) {
        this.colorTypes.set(color, vscode.window.createTextEditorDecorationType({ color }));
      }
    }
    for (const [color, type] of this.colorTypes) {
      editor.setDecorations(type, out.colors.get(color) ?? []);
    }
  }

  /** Lines a display element may cover: its own, plus the blank lines right after it. */
  private displaySpan(t: Token, parsed: ParsedDoc, display: boolean): { span: number; start: number } {
    const start = lineAt(parsed.lineStarts, t.start);
    const end = lineAt(parsed.lineStarts, t.end);
    let span = end - start + 1;
    if (display) {
      span += blankLinesAfter(parsed.text, parsed.lineStarts, end, MAX_BLANK_LINES);
    }
    return { span, start };
  }

  private decorateMath(t: MathToken, ctx: PassContext): void {
    if (!this.rendersMath(t)) {
      return;
    }
    const r = this.render(t, ctx.metrics, ctx.parsed);
    if (r.error) {
      // Left as source: the Problems panel and the squiggle report it.
      return;
    }
    const { span } = this.displaySpan(t, ctx.parsed, t.display);
    const box = layoutImage(r, t.display, span, ctx.metrics);
    const uriKey = `${this.renderKey(t, ctx.metrics, ctx.parsed)}|${box.widthPx.toFixed(2)}|${box.heightPx.toFixed(2)}`;
    let uri = this.uriCache.get(uriKey);
    if (!uri) {
      uri = vscode.Uri.parse(svgToDataUri(resizeSvg(r.svg, box.widthPx, box.heightPx)));
      this.uriCache.set(uriKey, uri);
    }
    pushImage(ctx, t, uri, box);
  }

  private decorateImage(t: ImageToken, ctx: PassContext): void {
    if (!this.settings.renderImages) {
      return;
    }
    const image = this.image(ctx.doc, t.path);
    if (!image) {
      return;
    }
    const { span } = this.displaySpan(t, ctx.parsed, true);
    const box = layoutImage({ widthPx: image.size.width, heightPx: image.size.height, depthPx: 0 }, true, span, ctx.metrics);
    const key = `img|${image.uri.toString()}|${box.widthPx.toFixed(2)}|${box.heightPx.toFixed(2)}`;
    let uri = this.uriCache.get(key);
    if (!uri) {
      uri = vscode.Uri.parse(svgToDataUri(framedImageSvg(image.dataUri, box.widthPx, box.heightPx)));
      this.uriCache.set(key, uri);
    }
    pushImage(ctx, t, uri, box);
  }

  /** The picture for an \includegraphics path, or undefined while it loads or if there is none. */
  private image(doc: vscode.TextDocument, ref: string): LoadedImage | undefined {
    const root = this.project.get(doc).root;
    const bases = [vscode.Uri.joinPath(doc.uri, '..')];
    if (root) {
      bases.unshift(vscode.Uri.joinPath(root, '..'));
    }
    const key = `${bases.map((b) => b.toString()).join('|')}|${ref}`;
    if (this.loadedImages.has(key)) {
      return this.loadedImages.get(key);
    }
    if (!this.images.has(key)) {
      const loading = findImage(bases, ref);
      this.images.set(key, loading);
      void loading.then((img) => {
        if (this.images.get(key) === loading) {
          this.loadedImages.set(key, img);
          if (img) {
            this.refreshDocument(doc.uri);
          }
        }
      });
    }
    return undefined;
  }

  private scheduleDiagnostics(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    clearTimeout(this.diagnosticTimers.get(key));
    this.diagnosticTimers.set(
      key,
      setTimeout(() => {
        this.diagnosticTimers.delete(key);
        void this.computeDiagnostics(doc);
      }, 300),
    );
  }

  /**
   * Report TeX errors of every formula in the Problems panel, including the
   * one being edited. Runs in slices so a long document does not freeze the
   * editor, and stops if the document changes meanwhile.
   */
  private async computeDiagnostics(doc: vscode.TextDocument): Promise<void> {
    if (doc.isClosed || !this.applies(doc)) {
      this.diagnostics.delete(doc.uri);
      return;
    }
    const parsed = this.parse(doc);
    const version = doc.version;
    const found: vscode.Diagnostic[] = [];
    const math = parsed.tokens.filter((t): t is MathToken => t.type === 'math' && this.rendersMath(t));
    for (let i = 0; i < math.length; i++) {
      if (i % 100 === 99) {
        await new Promise((resolve) => setImmediate(resolve));
        if (doc.isClosed || doc.version !== version) {
          return;
        }
      }
      const t = math[i];
      const key = `${t.display ? 'D' : 'I'}|${parsed.macroKey}|${t.tex}`;
      let error = this.errorCache.get(key);
      if (error === undefined) {
        error = this.mathjax().checkMath(t.tex, t.display, parsed.macros, parsed.macroKey) ?? null;
        this.errorCache.set(key, error);
      }
      if (error !== null) {
        const range = new vscode.Range(doc.positionAt(t.start), doc.positionAt(t.end));
        const message = t.table ? `Tableau : ${error}` : error;
        const d = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
        d.source = 'InlineTeX';
        found.push(d);
      }
    }
    this.diagnostics.set(doc.uri, found);
  }

  private hover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    if (!this.applies(doc)) {
      return undefined;
    }
    const offset = doc.offsetAt(pos);
    const parsed = this.parse(doc);
    // Innermost token under the cursor: tokens are sorted by start, nested ones come later.
    const t = parsed.tokens.findLast((x) => x.start <= offset && offset < x.end);
    if (!t) {
      return undefined;
    }
    const md = this.hoverContent(t, doc, parsed);
    return md && new vscode.Hover(md, new vscode.Range(doc.positionAt(t.start), doc.positionAt(t.end)));
  }

  private hoverContent(t: Token, doc: vscode.TextDocument, parsed: ParsedDoc): vscode.MarkdownString | undefined {
    const md = new vscode.MarkdownString();
    if (t.type === 'math' && this.rendersMath(t)) {
      const m = this.metrics(doc);
      const r = this.render(t, { ...m, scale: m.scale * 1.4 }, parsed);
      if (r.error) {
        return undefined;
      }
      md.appendMarkdown(`![formule](${svgToDataUri(r.svg)})`);
    } else if (t.type === 'image' && this.settings.renderImages) {
      const image = this.image(doc, t.path);
      if (!image) {
        return undefined;
      }
      md.appendMarkdown(`![${t.path}](${image.uri.toString()}|width=360)`);
    } else if (t.type === 'symbol' && t.style === 'note' && t.hover) {
      md.appendText(t.hover);
    } else if (t.type === 'format' && t.kind === 'link' && t.target) {
      md.appendMarkdown(`[${t.target}](${encodeURI(t.target)})`);
    } else {
      return undefined;
    }
    return md;
  }

  dispose(): void {
    clearTimeout(this.imageTimer);
    for (const timer of [...this.timers.values(), ...this.diagnosticTimers.values()]) {
      clearTimeout(timer);
    }
    for (const t of this.allTypes()) {
      t.dispose();
    }
    for (const d of [...this.disposables, this.diagnostics, this.status, this.project]) {
      d.dispose();
    }
  }
}

interface PassContext {
  doc: vscode.TextDocument;
  parsed: ParsedDoc;
  metrics: EditorMetrics;
  out: {
    hide: vscode.Range[];
    images: vscode.DecorationOptions[];
    symbols: vscode.DecorationOptions[];
    formats: Map<FormatKind, vscode.Range[]>;
    colors: Map<string, vscode.Range[]>;
  };
}

function tokenRange(doc: vscode.TextDocument, t: Token): vscode.Range {
  return new vscode.Range(doc.positionAt(t.start), doc.positionAt(t.end));
}

/** Hide the token's source and draw `uri` (an SVG of the given box) in its place. */
function pushImage(
  ctx: PassContext,
  t: Token,
  uri: vscode.Uri,
  box: { widthPx: number; heightPx: number; verticalAlign: string },
): void {
  const range = tokenRange(ctx.doc, t);
  ctx.out.hide.push(range);
  ctx.out.images.push({
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
function decorateText(t: FormatToken | SymbolToken, ctx: PassContext): void {
  const { doc, out } = ctx;
  const range = tokenRange(doc, t);
  if (t.type === 'symbol') {
    out.hide.push(range);
    out.symbols.push({
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
      out.hide.push(hidden);
    }
  }
  const arg = new vscode.Range(argStart, argEnd);
  if (t.kind === 'color' && t.color) {
    const list = out.colors.get(t.color) ?? [];
    list.push(arg);
    out.colors.set(t.color, list);
    return;
  }
  const list = out.formats.get(t.kind) ?? [];
  list.push(arg);
  out.formats.set(t.kind, list);
}

/**
 * Locate an \includegraphics file like LaTeX: relative to the root document,
 * then to the current one, trying the displayable extensions when none is given.
 */
async function findImage(bases: vscode.Uri[], ref: string): Promise<LoadedImage | undefined> {
  const ext = path.posix.extname(ref).toLowerCase();
  if (ext && !IMAGE_EXTENSIONS.includes(ext)) {
    return undefined;
  }
  const names = ext ? [ref] : IMAGE_EXTENSIONS.map((e) => ref + e);
  for (const base of bases) {
    for (const name of names) {
      const uri = vscode.Uri.joinPath(base, name);
      const image = await loadImage(uri, path.posix.extname(name).toLowerCase());
      if (image) {
        return image;
      }
    }
  }
  return undefined;
}

async function loadImage(uri: vscode.Uri, ext: string): Promise<LoadedImage | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_IMAGE_BYTES) {
      return undefined;
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    const size = imageSize(bytes, ext);
    return size ? { uri, dataUri: imageDataUri(bytes, ext), size } : undefined;
  } catch {
    return undefined;
  }
}

function readSettings(): Settings {
  const c = vscode.workspace.getConfiguration('inlineTeX');
  return {
    enabled: c.get('enabled', true),
    languages: c.get('languages', ['latex', 'tex']),
    renderMath: c.get('renderMath', true),
    renderTables: c.get('renderTables', true),
    renderFormatting: c.get('renderFormatting', true),
    renderImages: c.get('renderImages', true),
    revealOn: c.get('revealOn', 'cursor'),
    scale: c.get('scale', 1),
    color: c.get('color', ''),
  };
}
