import { describe, expect, it } from 'vitest';
import { framedImageSvg, imageSize } from '../src/render/image';

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

describe('imageSize', () => {
  it('reads PNG, GIF and JPEG headers', () => {
    expect(imageSize(png(640, 480), '.png')).toEqual({ width: 640, height: 480 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x01, 0x10, 0x00]);
    expect(imageSize(gif, '.gif')).toEqual({ width: 288, height: 16 });
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03,
    ]);
    expect(imageSize(jpeg, '.jpg')).toEqual({ width: 600, height: 300 });
  });

  it('reads SVG size from attributes or viewBox', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(imageSize(enc('<svg width="100" height="50px">'), '.svg')).toEqual({ width: 100, height: 50 });
    expect(imageSize(enc('<svg width="100%" viewBox="0 0 30 20">'), '.svg')).toEqual({ width: 30, height: 20 });
    expect(imageSize(enc('<svg>'), '.svg')).toBeUndefined();
  });

  it('frames the picture at the requested size', () => {
    const svg = framedImageSvg('data:image/png;base64,AA==', 40, 20);
    expect(svg).toContain('width="40.00px" height="20.00px"');
    expect(svg).toContain('href="data:image/png;base64,AA=="');
  });
});
