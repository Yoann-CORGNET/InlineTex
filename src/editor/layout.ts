/** Pure sizing helpers: no VS Code dependency. */

export interface EditorMetrics {
  fontSizePx: number;
  lineHeightPx: number;
  /** User scale factor for rendered math. */
  scale: number;
}

export interface ImageBox {
  widthPx: number;
  heightPx: number;
  /** CSS vertical-align value for the injected image. */
  verticalAlign: string;
}

/** Mirror VS Code's editor.lineHeight resolution (0 = auto, <8 = multiplier). */
export function resolveLineHeight(fontSize: number, lineHeight: number, isMac: boolean): number {
  if (lineHeight <= 0) {
    return Math.round(fontSize * (isMac ? 1.5 : 1.35));
  }
  if (lineHeight < 8) {
    return Math.round(fontSize * lineHeight);
  }
  return lineHeight;
}

/**
 * Pixel size of 1ex for MathJax output. TeX fonts have an x-height of 0.431em,
 * but editor monospace fonts sit near 0.5em: matching the latter keeps math
 * visually the same size as the surrounding text.
 */
export function exPx(m: EditorMetrics): number {
  return m.fontSizePx * 0.5 * m.scale;
}

/**
 * Fit a rendered formula into the editor lines it replaces.
 * Inline math stays on its line (scaled down if taller) and sits on the baseline.
 * Display math may use every line its source spans, anchored at the top.
 */
export function layoutImage(
  size: { widthPx: number; heightPx: number; depthPx: number },
  display: boolean,
  lineSpan: number,
  m: EditorMetrics,
): ImageBox {
  const maxHeight = display ? Math.max(1, lineSpan) * m.lineHeightPx : m.lineHeightPx;
  const ratio = size.heightPx > maxHeight ? maxHeight / size.heightPx : 1;
  const widthPx = Math.max(1, size.widthPx * ratio);
  const heightPx = Math.max(1, size.heightPx * ratio);
  if (display && lineSpan > 1) {
    return { widthPx, heightPx, verticalAlign: 'top' };
  }
  // Keep the image inside the line box: shift by the depth, clamped so it cannot overflow.
  const room = Math.max(0, (m.lineHeightPx - m.fontSizePx) / 2);
  const depth = Math.min(size.depthPx * ratio, (m.lineHeightPx - heightPx) / 2 + room);
  return { widthPx, heightPx, verticalAlign: `${(-Math.max(0, depth)).toFixed(2)}px` };
}
