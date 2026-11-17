import * as path from 'node:path';
import * as vscode from 'vscode';
import { InlineTexController } from './editor/controller';

export function activate(context: vscode.ExtensionContext): void {
  const controller = new InlineTexController(path.join(__dirname, 'fonts'));
  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand('inlineTeX.toggle', async () => {
      const cfg = vscode.workspace.getConfiguration('inlineTeX');
      const enabled = !cfg.get<boolean>('enabled', true);
      await cfg.update('enabled', enabled, settingTarget(cfg.inspect<boolean>('enabled')));
      vscode.window.setStatusBarMessage(enabled ? vscode.l10n.t('InlineTeX enabled') : vscode.l10n.t('InlineTeX disabled'), 2000);
    }),
    vscode.commands.registerCommand('inlineTeX.toggleDocument', () => controller.toggleDocument()),
  );
}

/**
 * Write where the effective value comes from: writing a user setting would be
 * shadowed by a workspace one, and the toggle would seem to do nothing. The
 * setting has window scope, so folder-level values do not apply.
 */
function settingTarget(info: ReturnType<vscode.WorkspaceConfiguration['inspect']>): vscode.ConfigurationTarget {
  return info?.workspaceValue === undefined ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;
}
