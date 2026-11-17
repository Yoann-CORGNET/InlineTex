import * as vscode from 'vscode';
import type { RevealOn } from './plan';

export interface Settings {
  enabled: boolean;
  languages: string[];
  renderMath: boolean;
  renderTables: boolean;
  renderFormatting: boolean;
  renderImages: boolean;
  revealOn: RevealOn;
  scale: number;
  color: string;
}

export function readSettings(): Settings {
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

/** Color of rendered math: the setting, else one that suits the theme. */
export function mathColor(settings: Settings): string {
  if (settings.color) {
    return settings.color;
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
