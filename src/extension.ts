import * as vscode from 'vscode';
import { InlineTexController } from './editor/controller';

export function activate(context: vscode.ExtensionContext): void {
  const controller = new InlineTexController();
  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand('inlineTeX.toggle', async () => {
      const cfg = vscode.workspace.getConfiguration('inlineTeX');
      const enabled = !cfg.get<boolean>('enabled', true);
      await cfg.update('enabled', enabled, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(`InlineTeX ${enabled ? 'activé' : 'désactivé'}`, 2000);
    }),
  );
}
