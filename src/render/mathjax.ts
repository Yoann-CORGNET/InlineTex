import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import { STATE } from '@mathjax/src/js/core/MathItem.js';
import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/js/svg.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/amscd/AmsCdConfiguration.js';
import '@mathjax/src/js/input/tex/bbox/BboxConfiguration.js';
import '@mathjax/src/js/input/tex/begingroup/BegingroupConfiguration.js';
import '@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import '@mathjax/src/js/input/tex/braket/BraketConfiguration.js';
import '@mathjax/src/js/input/tex/cancel/CancelConfiguration.js';
import '@mathjax/src/js/input/tex/cases/CasesConfiguration.js';
import '@mathjax/src/js/input/tex/centernot/CenternotConfiguration.js';
import '@mathjax/src/js/input/tex/color/ColorConfiguration.js';
import '@mathjax/src/js/input/tex/colortbl/ColortblConfiguration.js';
import '@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js';
import '@mathjax/src/js/input/tex/empheq/EmpheqConfiguration.js';
import '@mathjax/src/js/input/tex/enclose/EncloseConfiguration.js';
import '@mathjax/src/js/input/tex/extpfeil/ExtpfeilConfiguration.js';
import '@mathjax/src/js/input/tex/gensymb/GensymbConfiguration.js';
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js';
import '@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/noundefined/NoUndefinedConfiguration.js';
import '@mathjax/src/js/input/tex/physics/PhysicsConfiguration.js';
import '@mathjax/src/js/input/tex/textcomp/TextcompConfiguration.js';
import '@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js';
import '@mathjax/src/js/input/tex/unicode/UnicodeConfiguration.js';
import '@mathjax/src/js/input/tex/units/UnitsConfiguration.js';
import '@mathjax/src/js/input/tex/upgreek/UpgreekConfiguration.js';
import '@mathjax/src/js/input/tex/verb/VerbConfiguration.js';
import type { MacroTable } from '../parser/macros';

/** Packages registered by the imports above, in the order MathJax applies them. */
const PACKAGES = [
  'base', 'ams', 'amscd', 'bbox', 'begingroup', 'boldsymbol', 'braket', 'cancel', 'cases', 'centernot',
  'color', 'colortbl', 'configmacros', 'empheq', 'enclose', 'extpfeil', 'gensymb', 'mathtools', 'mhchem',
  'newcommand', 'noundefined', 'physics', 'textcomp', 'textmacros', 'unicode', 'units', 'upgreek', 'verb',
];

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

/** Key under which the font class is shared with the separately bundled glyph files. */
export const FONT_GLOBAL = Symbol.for('inlineTeX.mathjaxNewcmFont');

/**
 * MathJax 4 keeps rare glyphs in "dynamic" files loaded on first use. `load` must
 * evaluate the file named `name` (e.g. "arrows") synchronously, so that a
 * conversion never has to be retried.
 */
export function setFontLoader(load: (name: string) => void): void {
  (globalThis as Record<symbol, unknown>)[FONT_GLOBAL] = MathJaxNewcmFont;
  mathjax.asyncLoad = (file: string) => load(file.replace(/^.*\//, '').replace(/\.js$/, ''));
  mathjax.asyncIsSynchronous = true;
}

type MathDocument = ReturnType<typeof createDocument>;

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

/** One MathJax document per macro set, so that split editors do not rebuild it on every render. */
const documents = new Map<string, MathDocument>();
const MAX_DOCUMENTS = 4;

/**
 * One font instance shared by every document. With synchronous loading, a
 * glyph file is set up only on the instance that first needed it: a second
 * instance would then loop forever asking for it.
 */
let font: InstanceType<typeof MathJaxNewcmFont> | undefined;

function createDocument(macros: MacroTable) {
  const tex = new TeX({
    packages: PACKAGES,
    macros,
    formatError: (_jax: unknown, err: Error) => {
      throw err;
    },
  });
  font ??= new MathJaxNewcmFont();
  const svg = new SVG({ fontCache: 'none', fontData: font });
  return mathjax.document('', { InputJax: tex, OutputJax: svg });
}

function documentFor(macros: MacroTable, key: string): MathDocument {
  let doc = documents.get(key);
  if (doc) {
    documents.delete(key);
  } else {
    doc = createDocument(macros);
    if (documents.size >= MAX_DOCUMENTS) {
      documents.delete(documents.keys().next().value as string);
    }
  }
  documents.set(key, doc);
  return doc;
}

/**
 * Convert with a fresh TeX state: each formula is converted on its own and may
 * be converted again (hover, diagnostics), so labels and equation numbers from
 * a previous conversion must not linger ("Label multiply defined").
 */
function convert(macros: MacroTable, macroKey: string, tex: string, options: Record<string, unknown>) {
  const doc = documentFor(macros, macroKey);
  for (const jax of doc.inputJax) {
    jax.reset();
  }
  return doc.convert(tex, options);
}

/**
 * Table rules and frames are <line> and <rect> elements styled by MathJax's
 * stylesheet, which a standalone image does not have: without these rules the
 * frame is filled and the rules have no width.
 */
const TABLE_STYLE =
  '<style>line[data-line],rect[data-frame]{stroke-width:70px;fill:none}' +
  '.mjx-dashed{stroke-dasharray:140}.mjx-dotted{stroke-linecap:round;stroke-dasharray:0,140}</style>';

function exToPx(value: string | null, exPx: number): number {
  if (!value) {
    return 0;
  }
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n * exPx : 0;
}

/**
 * Render `tex` to a self-contained SVG. `macroKey` identifies `macros`
 * (usually its JSON) so that the MathJax document is reused across calls.
 */
export function renderMath(
  tex: string,
  opts: RenderOptions,
  macros: MacroTable = {},
  macroKey = JSON.stringify(macros),
): RenderedMath {
  try {
    const node = convert(macros, macroKey, tex, { display: opts.display, em: opts.exPx * 2, ex: opts.exPx });
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
    if (svg.includes('data-line=') || svg.includes('data-frame=')) {
      svg = svg.replace(/^<svg[^>]*>/, (open) => open + TABLE_STYLE);
    }
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
 * TeX error of `tex`, or undefined if it compiles. Stops before typesetting,
 * which makes it much cheaper than renderMath for formulas that are not shown.
 */
export function checkMath(
  tex: string,
  display: boolean,
  macros: MacroTable = {},
  macroKey = JSON.stringify(macros),
): string | undefined {
  try {
    convert(macros, macroKey, tex, { display, end: STATE.COMPILED });
    return undefined;
  } catch (e) {
    return errorMessage(e);
  }
}
