/** SVG string helpers, kept apart from MathJax so that loading them is cheap. */

/**
 * Set the intrinsic size of a rendered SVG. VS Code draws decoration images at
 * their intrinsic size, so scaling must be baked into the SVG itself.
 */
export function resizeSvg(svg: string, widthPx: number, heightPx: number): string {
  return svg
    .replace(/width="[^"]*"/, `width="${widthPx.toFixed(2)}px"`)
    .replace(/height="[^"]*"/, `height="${heightPx.toFixed(2)}px"`);
}

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
