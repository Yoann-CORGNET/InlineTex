/**
 * Runs inside a real extension host, on the production bundle: checks what
 * vitest cannot, i.e. lazy MathJax loading, glyph files from dist/fonts,
 * diagnostics, hover and the toggle command. Decorations stay a visual check.
 */
import * as assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import * as vscode from 'vscode';

async function poll<T>(read: () => T, done: (value: T) => boolean, timeoutMs = 15000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = read();
  while (!done(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = read();
  }
  return value;
}

/** One line per check, read back by run.mjs: the host's console does not always reach the terminal. */
function report(line: string): void {
  console.log(line);
  const file = process.env.INLINETEX_RESULTS;
  if (file) {
    appendFileSync(file, `${line}\n`);
  }
}

async function check(name: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
    report(`ok   ${name}`);
  } catch (e) {
    report(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension('inlinetex.inlinetex');
  assert.ok(ext, 'extension not found');
  await ext.activate();
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.ok(folder, 'no workspace folder');
  const uri = vscode.Uri.joinPath(folder, 'demo.tex');
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);

  await check('reports exactly the broken formula in the Problems panel', async () => {
    const ours = () => vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'InlineTeX');
    const diags = await poll(ours, (d) => d.length > 0);
    assert.equal(diags.length, 1, diags.map((d) => `${d.range.start.line}: ${d.message}`).join('\n'));
    assert.match(doc.getText(diags[0].range), /\\frac\{1\}\{/);
  });

  await check('renders a formula and a table on hover, glyph files included', async () => {
    for (const tex of [String.raw`$\frac{a}{b}$`, String.raw`$\abs{x} \le \Q$`, String.raw`\begin{tabular}{|l|c|r|}`]) {
      const at = doc.positionAt(doc.getText().indexOf(tex) + 2);
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, at);
      const text = hovers.flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value))).join('\n');
      assert.match(text, /data:image\/svg\+xml;base64,/, `${tex} at ${at.line}:${at.character}: ${text.slice(0, 200)}`);
    }
  });

  await check('toggle writes where the setting is defined', async () => {
    const cfg = () => vscode.workspace.getConfiguration('inlineTeX');
    await cfg().update('enabled', true, vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('inlineTeX.toggle');
    const info = await poll(
      () => cfg().inspect<boolean>('enabled'),
      (i) => i?.workspaceValue === false,
    );
    assert.equal(info?.workspaceValue, false);
    assert.equal(info?.globalValue, undefined);
  });
}
