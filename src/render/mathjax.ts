import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

export interface RenderOptions {
  /** CSS color applied to the glyphs (images do not inherit currentColor). */
  color: string;
  /** Pixel size of 1ex, derived from the editor font size. */
  exPx: number;
  display: boolean;
}

export interface RenderedMath {
  svg: string;
  widthPx: number;
  heightPx: number;
  /** Pixels below the baseline (MathJax vertical-align). */
  depthPx: number;
  error?: string;
}

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

let macroKey = '';
let doc = createDocument({});

function createDocument(macros: Record<string, string | [string, number]>) {
  const tex = new TeX({
    packages: AllPackages.filter((p) => p !== 'bussproofs'),
    macros,
    formatError: (_jax: unknown, err: Error) => {
      throw err;
    },
  });
  const svg = new SVG({ fontCache: 'none' });
  return mathjax.document('', { InputJax: tex, OutputJax: svg });
}

/** Rebuild the MathJax document when user macros change. */
export function setMacros(macros: Record<string, string | [string, number]>): void {
  const key = JSON.stringify(macros);
  if (key === macroKey) {
    return;
  }
  macroKey = key;
  doc = createDocument(macros);
}

function exToPx(value: string | null, exPx: number): number {
  if (!value) {
    return 0;
  }
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n * exPx : 0;
}

export function renderMath(tex: string, opts: RenderOptions): RenderedMath {
  try {
    const node = doc.convert(tex, { display: opts.display, em: opts.exPx * 2, ex: opts.exPx });
    const svgNode = adaptor.firstChild(node) as never;
    const width = exToPx(adaptor.getAttribute(svgNode, 'width'), opts.exPx);
    const height = exToPx(adaptor.getAttribute(svgNode, 'height'), opts.exPx);
    const style = adaptor.getAttribute(svgNode, 'style') ?? '';
    const va = /vertical-align:\s*(-?[\d.]+)ex/.exec(style);
    const depth = va ? -Number.parseFloat(va[1]) * opts.exPx : 0;
    adaptor.setAttribute(svgNode, 'width', `${width.toFixed(2)}px`);
    adaptor.setAttribute(svgNode, 'height', `${height.toFixed(2)}px`);
    adaptor.setAttribute(svgNode, 'style', `color:${opts.color}`);
    adaptor.setAttribute(svgNode, 'xmlns', 'http://www.w3.org/2000/svg');
    let svg = adaptor.outerHTML(svgNode);
    svg = svg.replaceAll('currentColor', opts.color);
    return { svg, widthPx: width, heightPx: height, depthPx: depth };
  } catch (e) {
    return {
      svg: '',
      widthPx: 0,
      heightPx: 0,
      depthPx: 0,
      error: errorMessage(e),
    };
  }
}

/** MathJax throws TexError objects that are not Error instances. */
function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string') {
    return e.message;
  }
  return typeof e === 'string' ? e : 'Erreur de rendu MathJax';
}

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
