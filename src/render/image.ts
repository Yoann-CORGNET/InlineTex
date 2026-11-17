/**
 * Image previews for \includegraphics. VS Code draws a decoration image at its
 * intrinsic size, so the picture is wrapped in an SVG of the wanted size.
 * PDF and EPS figures cannot be shown in the editor and are left as source.
 */

/** Formats a decoration can display, in the order LaTeX-style lookup tries them. */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg'];

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

/**
 * File names LaTeX would try for an \includegraphics path: the path itself if
 * it has a displayable extension, each displayable extension if it has none,
 * nothing otherwise (a PDF, say).
 */
export function imageFileNames(ref: string): string[] {
  const dot = ref.lastIndexOf('.');
  const ext = dot > ref.lastIndexOf('/') ? ref.slice(dot).toLowerCase() : '';
  if (!ext) {
    return IMAGE_EXTENSIONS.map((e) => ref + e);
  }
  return IMAGE_EXTENSIONS.includes(ext) ? [ref] : [];
}

export interface ImageSize {
  width: number;
  height: number;
}

function u16be(b: Uint8Array, i: number): number {
  return (b[i] << 8) | b[i + 1];
}

function u32be(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

function jpegSize(b: Uint8Array): ImageSize | undefined {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      return undefined;
    }
    const marker = b[i + 1];
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + u16be(b, i + 2);
  }
  return undefined;
}

function svgLength(value: string | undefined): number | undefined {
  const n = value ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(n) && n > 0 && !value?.trim().endsWith('%') ? n : undefined;
}

function svgSize(text: string): ImageSize | undefined {
  const root = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!root) {
    return undefined;
  }
  const attr = (name: string) => new RegExp(String.raw`\s${name}\s*=\s*["']([^"']*)["']`).exec(root)?.[1];
  const width = svgLength(attr('width'));
  const height = svgLength(attr('height'));
  if (width && height) {
    return { width, height };
  }
  const box = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  return box?.length === 4 && box[2] > 0 && box[3] > 0 ? { width: box[2], height: box[3] } : undefined;
}

/** Intrinsic pixel size read from the file header, or undefined if unknown. */
export function imageSize(bytes: Uint8Array, ext: string): ImageSize | undefined {
  switch (ext) {
    case '.png':
      return bytes.length >= 24 ? { width: u32be(bytes, 16), height: u32be(bytes, 20) } : undefined;
    case '.gif':
      return bytes.length >= 10 ? { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) } : undefined;
    case '.jpg':
    case '.jpeg':
      return jpegSize(bytes);
    case '.svg':
      return svgSize(new TextDecoder().decode(bytes.subarray(0, 4096)));
    default:
      return undefined;
  }
}

/** Data URI of `bytes`, for embedding. */
export function imageDataUri(bytes: Uint8Array, ext: string): string {
  return `data:${MIME[ext]};base64,${Buffer.from(bytes).toString('base64')}`;
}

/** An SVG of exactly `widthPx` x `heightPx` showing the image at `dataUri`. */
export function framedImageSvg(dataUri: string, widthPx: number, heightPx: number): string {
  const w = widthPx.toFixed(2);
  const h = heightPx.toFixed(2);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}px" height="${h}px" viewBox="0 0 ${w} ${h}">` +
    `<image href="${dataUri}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/></svg>`
  );
}
