import * as vscode from 'vscode';
import type { MacroTable } from '../parser/macros';
import type { MathToken, Token } from '../parser/tokens';
import { Lru } from '../util/lru';
import { tokenRange } from './decorations';

/** What the diagnostics need from the controller. */
export interface DiagnosticSource {
  applies(doc: vscode.TextDocument): boolean;
  parse(doc: vscode.TextDocument): { tokens: Token[]; macros: MacroTable; macroKey: string };
  rendersMath(t: MathToken): boolean;
  /** TeX error of a formula, or undefined. */
  check(tex: string, display: boolean, macros: MacroTable, macroKey: string): string | undefined;
}

/** TeX errors of every formula, reported in the Problems panel. */
export class MathDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('InlineTeX');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly errors = new Lru<string, string | null>(5000);

  constructor(private readonly source: DiagnosticSource) {}

  schedule(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.compute(doc);
      }, 300),
    );
  }

  forget(uri: vscode.Uri): void {
    const key = uri.toString();
    this.collection.delete(uri);
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
  }

  /**
   * Check every formula, including the one being edited. Runs in slices so a
   * long document does not freeze the editor, and stops if the document
   * changes meanwhile.
   */
  private async compute(doc: vscode.TextDocument): Promise<void> {
    if (doc.isClosed || !this.source.applies(doc)) {
      this.collection.delete(doc.uri);
      return;
    }
    const parsed = this.source.parse(doc);
    const version = doc.version;
    const found: vscode.Diagnostic[] = [];
    const math = parsed.tokens.filter((t): t is MathToken => t.type === 'math' && this.source.rendersMath(t));
    for (let i = 0; i < math.length; i++) {
      if (i % 100 === 99) {
        await new Promise((resolve) => setImmediate(resolve));
        if (doc.isClosed || doc.version !== version) {
          return;
        }
      }
      const t = math[i];
      const error = this.errorOf(t, parsed.macros, parsed.macroKey);
      if (error !== null) {
        const message = t.table ? `Tableau : ${error}` : error;
        const d = new vscode.Diagnostic(tokenRange(doc, t), message, vscode.DiagnosticSeverity.Error);
        d.source = 'InlineTeX';
        found.push(d);
      }
    }
    this.collection.set(doc.uri, found);
  }

  /** TeX error of a formula, or null, cached by display mode, macros and source. */
  private errorOf(t: MathToken, macros: MacroTable, macroKey: string): string | null {
    const key = `${t.display ? 'D' : 'I'}|${macroKey}|${t.tex}`;
    let error = this.errors.get(key);
    if (error === undefined) {
      error = this.source.check(t.tex, t.display, macros, macroKey) ?? null;
      this.errors.set(key, error);
    }
    return error;
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.collection.dispose();
  }
}
