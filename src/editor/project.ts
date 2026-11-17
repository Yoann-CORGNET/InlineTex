import * as vscode from 'vscode';
import { collectMacros, type MacroTable } from '../parser/macros';
import { findIncludes, hasDocumentClass, includeFileName, magicRoot } from '../parser/project';

/** Bound on files read for one project, against include cycles and huge trees. */
const MAX_FILES = 64;

/** Delay that merges the save event and the watcher event of one save. */
const INVALIDATE_DELAY_MS = 300;

interface Resolved {
  macros: MacroTable;
  key: string;
  /** Root document of the project, when one was found. */
  root?: vscode.Uri;
}

/** Result for a document whose project brings no macros. */
export const NO_PROJECT: Resolved = { macros: {}, key: '{}' };

function openDocument(key: string): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
}

/**
 * Macros defined in the other files of a LaTeX project: the root document
 * (`% !TEX root`, or a sibling or parent `.tex` with \documentclass that
 * includes this one), what it \input s or \include s, and the local `.sty`
 * files it loads. Files are read asynchronously; `onChange` fires when the
 * macros known for a document change.
 */
export class ProjectMacros implements vscode.Disposable {
  private readonly texts = new Map<string, Promise<string | undefined>>();
  private readonly resolved = new Map<string, Resolved>();
  private readonly running = new Set<string>();
  private readonly disposables: vscode.Disposable[] = [];
  private invalidateTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly onChange: (uri: vscode.Uri) => void) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{tex,sty}');
    const invalidate = () => this.scheduleInvalidate();
    this.disposables.push(
      watcher,
      watcher.onDidChange(invalidate),
      watcher.onDidCreate(invalidate),
      watcher.onDidDelete(invalidate),
      // The watcher misses files outside the workspace.
      vscode.workspace.onDidSaveTextDocument((d) => {
        if (/\.(tex|sty)$/i.test(d.uri.path)) {
          invalidate();
        }
      }),
    );
  }

  /** Macros from the rest of the project known so far; starts a lookup when needed. */
  get(doc: vscode.TextDocument): Resolved {
    const key = doc.uri.toString();
    const known = this.resolved.get(key);
    if (!known) {
      this.start(doc, () => this.store(doc.uri, NO_PROJECT));
    }
    return known ?? NO_PROJECT;
  }

  private start(doc: vscode.TextDocument, onError: () => void): void {
    const key = doc.uri.toString();
    if (this.running.has(key)) {
      return;
    }
    this.running.add(key);
    void this.resolve(doc).then((r) => this.store(doc.uri, r), onError);
  }

  private store(uri: vscode.Uri, r: Resolved): void {
    const key = uri.toString();
    this.running.delete(key);
    const before = this.resolved.get(key)?.key ?? NO_PROJECT.key;
    this.resolved.set(key, r);
    if (r.key !== before) {
      this.onChange(uri);
    }
  }

  private scheduleInvalidate(): void {
    clearTimeout(this.invalidateTimer);
    this.invalidateTimer = setTimeout(() => this.invalidate(), INVALIDATE_DELAY_MS);
  }

  private invalidate(): void {
    this.texts.clear();
    // Keep the previous result until the new one lands, so nothing flickers.
    for (const key of [...this.resolved.keys()]) {
      const doc = openDocument(key);
      if (doc) {
        this.start(doc, () => this.running.delete(key));
      } else {
        this.resolved.delete(key);
      }
    }
  }

  private async resolve(doc: vscode.TextDocument): Promise<Resolved> {
    const root = await this.findRoot(doc);
    const macros: MacroTable = {};
    if (root) {
      await this.walk(root, vscode.Uri.joinPath(root, '..'), doc.uri.toString(), new Set(), macros);
    }
    return { macros, key: JSON.stringify(macros), root };
  }

  /**
   * Collect macros of `file` and of what it includes, in document order. The
   * document being edited (`self`) is followed but not collected: the
   * controller reads its live macros itself.
   */
  private async walk(
    file: vscode.Uri,
    rootDir: vscode.Uri,
    self: string,
    seen: Set<string>,
    out: MacroTable,
  ): Promise<void> {
    const key = file.toString();
    seen.add(key);
    const text = await this.read(file);
    if (text === undefined) {
      return;
    }
    if (key !== self) {
      Object.assign(out, collectMacros(text));
    }
    for (const inc of findIncludes(text)) {
      const target = vscode.Uri.joinPath(rootDir, includeFileName(inc));
      if (seen.size >= MAX_FILES || seen.has(target.toString())) {
        continue;
      }
      await this.walk(target, rootDir, self, seen, out);
    }
  }

  private async findRoot(doc: vscode.TextDocument): Promise<vscode.Uri | undefined> {
    const text = doc.getText();
    const dir = vscode.Uri.joinPath(doc.uri, '..');
    const magic = magicRoot(text);
    if (magic) {
      return vscode.Uri.joinPath(dir, magic);
    }
    if (hasDocumentClass(text)) {
      return doc.uri;
    }
    for (const candidateDir of [dir, vscode.Uri.joinPath(dir, '..')]) {
      for (const candidate of await this.texFiles(candidateDir)) {
        if (await this.includes(candidate, doc.uri)) {
          return candidate;
        }
      }
    }
    return undefined;
  }

  private async texFiles(dir: vscode.Uri): Promise<vscode.Uri[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(dir);
      return entries
        .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.tex'))
        .map(([name]) => vscode.Uri.joinPath(dir, name));
    } catch {
      return [];
    }
  }

  /** True if `root` is a main document whose include tree reaches `target`. */
  private async includes(root: vscode.Uri, target: vscode.Uri): Promise<boolean> {
    const text = await this.read(root);
    if (!text || !hasDocumentClass(text)) {
      return false;
    }
    const rootDir = vscode.Uri.joinPath(root, '..');
    const wanted = target.toString();
    const seen = new Set([root.toString()]);
    const queue = [text];
    while (queue.length > 0 && seen.size < MAX_FILES) {
      for (const inc of findIncludes(queue.shift() ?? '')) {
        if (inc.kind !== 'tex') {
          continue;
        }
        const uri = vscode.Uri.joinPath(rootDir, includeFileName(inc));
        const key = uri.toString();
        if (key === wanted) {
          return true;
        }
        if (!seen.has(key)) {
          seen.add(key);
          queue.push((await this.read(uri)) ?? '');
        }
      }
    }
    return false;
  }

  /** Text of `uri`: the open document if any (unsaved edits included), else the file. */
  private read(uri: vscode.Uri): Promise<string | undefined> {
    const key = uri.toString();
    const open = openDocument(key);
    if (open) {
      return Promise.resolve(open.getText());
    }
    let text = this.texts.get(key);
    if (!text) {
      text = Promise.resolve(vscode.workspace.fs.readFile(uri)).then(
        (bytes) => new TextDecoder().decode(bytes),
        () => undefined,
      );
      this.texts.set(key, text);
    }
    return text;
  }

  dispose(): void {
    clearTimeout(this.invalidateTimer);
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
