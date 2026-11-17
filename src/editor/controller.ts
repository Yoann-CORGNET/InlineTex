import * as path from 'node:path';
import * as vscode from 'vscode';
import { collectMacros, type MacroTable, textMacros } from '../parser/macros';
import { scanMarkdown } from '../parser/markdown';
import { scan } from '../parser/scan';
import type { ImageToken, MathToken, Token } from '../parser/tokens';
import { framedImageSvg } from '../render/image';
import type * as MathJax from '../render/mathjax';
import type { RenderedMath } from '../render/mathjax';
import { resizeSvg, svgToDataUri } from '../render/svg';
import { Lru } from '../util/lru';
import { DecorationTypes, emptyDecorationSet, pushImage, pushText, tokenRange, type DecorationSet } from './decorations';
import { MathDiagnostics } from './diagnostics';
import { ImageLoader } from './images';
import { exPx, layoutImage, resolveLineHeight, type EditorMetrics } from './layout';
import { displaySpan, lineStarts, linesToOffsets, tokensToDecorate } from './plan';
import { NO_PROJECT, ProjectMacros } from './project';
import { mathColor, readSettings } from './settings';

interface ParsedDoc {
  version: number;
  text: string;
  lineStarts: number[];
  tokens: Token[];
  /** Macros of this document, merged over those of the rest of the project. */
  macros: MacroTable;
  /** Short id of `macros`, used in cache keys instead of the table itself. */
  macroKey: string;
  ownMacros: MacroTable;
  /** Key of the project macros the merge was made with. */
  externalKey: string;
}

/** State of one decoration pass over an editor. */
interface PassContext {
  doc: vscode.TextDocument;
  parsed: ParsedDoc;
  metrics: EditorMetrics;
  out: DecorationSet;
}

/** Lines kept decorated above and below the viewport, so scrolling does not flash source. */
const VISIBLE_MARGIN = 30;
/** Blank lines after display content that it may draw over. */
const MAX_BLANK_LINES = 3;

type MathJaxModule = typeof MathJax;

/** Ids of the macro tables met recently, so cache keys hold a short id rather than the whole table. */
const macroIds = new Lru<string, string>(64);
let nextMacroId = 0;

function macroId(macros: MacroTable): string {
  const json = JSON.stringify(macros);
  let id = macroIds.get(json);
  if (id === undefined) {
    id = `m${nextMacroId++}`;
    macroIds.set(json, id);
  }
  return id;
}

export class InlineTexController implements vscode.Disposable {
  private readonly types = new DecorationTypes();
  private readonly parsed = new Map<string, ParsedDoc>();
  private readonly svgCache = new Lru<string, RenderedMath>(2000);
  private readonly uriCache = new Lru<string, vscode.Uri>(2000);
  /** Framed pictures are large (up to a few MB each): kept apart from formulas, in a small cache. */
  private readonly imageUriCache = new Lru<string, vscode.Uri>(32);
  /** Documents whose rendering was suspended from the status bar, for this session. */
  private readonly paused = new Set<string>();
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private readonly project = new ProjectMacros((uri) => this.refreshDocument(uri));
  private readonly images = new ImageLoader(
    (uri) => this.redrawDocument(uri),
    () => this.refreshAll(),
  );
  private readonly diagnostics = new MathDiagnostics({
    applies: (doc) => this.applies(doc),
    parse: (doc) => this.parse(doc),
    rendersMath: (t) => this.rendersMath(t),
    check: (tex, display, macros, macroKey) => this.mathjax().checkMath(tex, display, macros, macroKey),
  });
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timers = new Map<vscode.TextEditor, ReturnType<typeof setTimeout>>();
  private settings = readSettings();
  private mathjaxModule: MathJaxModule | undefined;

  /** `fontDir` holds the MathJax glyph files built next to the bundle. */
  constructor(private readonly fontDir: string) {
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
        this.parsed.delete(d.uri.toString());
        this.diagnostics.forget(d.uri);
      }),
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
      this.diagnostics.schedule(ed.document);
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
        this.diagnostics.schedule(ed.document);
      }
    }
  }

  /** Redraw the document's editors soon, without overriding a pass already scheduled. */
  private redrawDocument(uri: vscode.Uri): void {
    const key = uri.toString();
    for (const ed of vscode.window.visibleTextEditors) {
      if (ed.document.uri.toString() === key && !this.timers.has(ed)) {
        this.schedule(ed, 0);
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
    const external = markdown ? NO_PROJECT : this.project.get(doc);
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
        tokens: [],
        ownMacros: collectMacros(text),
        macros: {},
        macroKey: '',
        externalKey: '',
      };
    }
    parsed.macros = { ...external.macros, ...parsed.ownMacros };
    parsed.macroKey = macroId(parsed.macros);
    // The text uses the macros too (\code for \texttt): scan again when the project's arrive.
    parsed.tokens = markdown ? scanMarkdown(parsed.text) : scan(parsed.text, textMacros(parsed.macros));
    parsed.externalKey = external.key;
    this.parsed.set(key, parsed);
    this.diagnostics.schedule(doc);
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

  /** Formulas and tables share the MathJax pipeline but have their own setting. */
  private rendersMath(t: MathToken): boolean {
    return t.table ? this.settings.renderTables : this.settings.renderMath;
  }

  private renderKey(token: MathToken, m: EditorMetrics, parsed: ParsedDoc): string {
    return `${token.display ? 'D' : 'I'}|${mathColor(this.settings)}|${exPx(m)}|${parsed.macroKey}|${token.tex}`;
  }

  private render(token: MathToken, m: EditorMetrics, parsed: ParsedDoc, key = this.renderKey(token, m, parsed)): RenderedMath {
    let r = this.svgCache.get(key);
    if (!r) {
      const opts = { color: mathColor(this.settings), exPx: exPx(m), display: token.display };
      r = this.mathjax().renderMath(token.tex, opts, parsed.macros, parsed.macroKey);
      this.svgCache.set(key, r);
    }
    return r;
  }

  private update(editor: vscode.TextEditor): void {
    const doc = editor.document;
    if (!this.applies(doc)) {
      this.types.clear(editor);
      return;
    }
    const parsed = this.parse(doc);
    const ctx: PassContext = { doc, parsed, metrics: this.metrics(doc), out: emptyDecorationSet() };
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
        pushText(ctx.out, doc, t);
      }
    }
    this.types.apply(editor, ctx.out);
  }

  private decorateMath(t: MathToken, ctx: PassContext): void {
    if (!this.rendersMath(t)) {
      return;
    }
    const key = this.renderKey(t, ctx.metrics, ctx.parsed);
    const r = this.render(t, ctx.metrics, ctx.parsed, key);
    if (r.error) {
      // Left as source: the Problems panel and the squiggle report it.
      return;
    }
    const box = layoutImage(r, t.display, span(t, ctx.parsed, t.display), ctx.metrics);
    const uri = cachedUri(this.uriCache, key, box, () => resizeSvg(r.svg, box.widthPx, box.heightPx));
    pushImage(ctx.out, ctx.doc, t, uri, box);
  }

  private decorateImage(t: ImageToken, ctx: PassContext): void {
    if (!this.settings.renderImages) {
      return;
    }
    const image = this.images.get(ctx.doc, this.project.get(ctx.doc).root, t.path);
    if (!image) {
      return;
    }
    const size = { widthPx: image.size.width, heightPx: image.size.height, depthPx: 0 };
    const box = layoutImage(size, true, span(t, ctx.parsed, true), ctx.metrics);
    const uri = cachedUri(this.imageUriCache, image.uri.toString(), box, () =>
      framedImageSvg(image.dataUri, box.widthPx, box.heightPx),
    );
    pushImage(ctx.out, ctx.doc, t, uri, box);
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
    return md && new vscode.Hover(md, tokenRange(doc, t));
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
      const image = this.images.get(doc, this.project.get(doc).root, t.path);
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
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    for (const d of [...this.disposables, this.types, this.images, this.diagnostics, this.status, this.project]) {
      d.dispose();
    }
  }
}

/** Lines the token may cover; display content also takes the blank lines after it. */
function span(t: Token, parsed: ParsedDoc, display: boolean): number {
  return displaySpan(parsed.text, parsed.lineStarts, t.start, t.end, display ? MAX_BLANK_LINES : 0);
}

/** Data URI of the SVG `build` makes at the size of `box`, cached under `key` and that size. */
function cachedUri(
  cache: Lru<string, vscode.Uri>,
  key: string,
  box: { widthPx: number; heightPx: number },
  build: () => string,
): vscode.Uri {
  const sized = `${key}|${box.widthPx.toFixed(2)}|${box.heightPx.toFixed(2)}`;
  let uri = cache.get(sized);
  if (!uri) {
    uri = vscode.Uri.parse(svgToDataUri(build()));
    cache.set(sized, uri);
  }
  return uri;
}
