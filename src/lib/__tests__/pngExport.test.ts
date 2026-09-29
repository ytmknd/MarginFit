import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { addMargin, computeLayout, initialAdjust, moveContent, type SourceGeometry } from '../geometry';
import { crc32, exportPngLossless, filterRows, parseChunks, readPngInfo, unfilter } from '../pngUtils';
import { pxToMm } from '../units';

const CH: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** PNG with pseudo-random pixel bytes; returns the file and its raw (unfiltered) pixel rows. */
function makePng(w: number, h: number, colorType: number, bitDepth: number, extra: Uint8Array[] = []) {
  const bpp = (CH[colorType] * bitDepth) / 8;
  const row = w * bpp;
  const raw = new Uint8Array(row * h);
  let seed = 12345;
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = seed >> 16;
  }
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  const idat = new Uint8Array(deflateSync(filterRows(raw, h, row, bpp)));
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return { png, raw, bpp, row };
}

function decodeRaw(png: Uint8Array) {
  const info = readPngInfo(png);
  const bpp = (CH[info.colorType] * info.bitDepth) / 8;
  const raw = unfilter(new Uint8Array(inflateSync(info.idat)), info.height, info.width * bpp, bpp);
  return { info, raw, bpp };
}

function src(w: number, h: number, dpi = 600): SourceGeometry {
  return { kind: 'png', pixelWidth: w, pixelHeight: h, dpi, widthMm: pxToMm(w, dpi), heightMm: pxToMm(h, dpi) };
}

describe('filterRows / unfilter', () => {
  it('round-trips for every bpp', () => {
    for (const [ct, bd] of [[0, 8], [2, 8], [6, 8], [0, 16], [2, 16]]) {
      const { raw, row, bpp } = makePng(37, 11, ct, bd);
      expect(unfilter(filterRows(raw, 11, row, bpp), 11, row, bpp)).toEqual(raw);
    }
  });
});

describe('exportPngLossless', () => {
  it('pads with white and copies source pixels byte-for-byte (RGB 8-bit)', async () => {
    const W = 120;
    const H = 80;
    const { png, raw, row, bpp } = makePng(W, H, 2, 8);
    const s = src(W, H);
    let a = initialAdjust(s);
    a = addMargin(a, 'left', pxToMm(10, 600));
    a = addMargin(a, 'top', pxToMm(5, 600));
    a = addMargin(a, 'right', pxToMm(3, 600));
    const layout = computeLayout(s, a);
    expect(layout.raster).toMatchObject({ dx: 10, dy: 5, canvasWidth: 133, canvasHeight: 85 });

    const out = await exportPngLossless(readPngInfo(png), layout, 'white');
    const d = decodeRaw(out);
    expect(d.info).toMatchObject({ width: 133, height: 85, colorType: 2, bitDepth: 8, dpi: 600 });
    const orow = 133 * bpp;
    for (let y = 0; y < 85; y++) {
      for (let x = 0; x < 133; x++) {
        const px = d.raw.subarray(y * orow + x * bpp, y * orow + (x + 1) * bpp);
        const sx = x - 10;
        const sy = y - 5;
        if (sx >= 0 && sx < W && sy >= 0 && sy < H) {
          expect(Array.from(px)).toEqual(Array.from(raw.subarray(sy * row + sx * bpp, sy * row + (sx + 1) * bpp)));
        } else {
          expect(Array.from(px)).toEqual([255, 255, 255]);
        }
      }
    }
    const types = parseChunks(out).map((c) => c.type);
    expect(types.slice(0, 2)).toEqual(['IHDR', 'pHYs']);
  });

  it('crops when the content extends beyond the paper', async () => {
    const W = 50;
    const H = 40;
    const { png, raw, row, bpp } = makePng(W, H, 0, 8);
    const s = src(W, H);
    // move 7 px left and 3 px up, paper unchanged → left/top cropped, right/bottom padded
    const layout = computeLayout(s, moveContent(initialAdjust(s), pxToMm(-7, 600), pxToMm(-3, 600)));
    const out = await exportPngLossless(readPngInfo(png), layout, 'white');
    const d = decodeRaw(out);
    expect(d.info).toMatchObject({ width: 50, height: 40, colorType: 0 });
    expect(d.raw[0]).toBe(raw[3 * row + 7]);
    expect(d.raw[(39 - 3) * 50 + (49 - 7)]).toBe(raw[39 * row + 49]);
    expect(d.raw[39 * 50 + 49]).toBe(255); // padded corner
    expect(bpp).toBe(1);
  });

  it('keeps 16-bit grayscale and uses transparent background with alpha images', async () => {
    const g16 = makePng(9, 4, 0, 16);
    const l1 = computeLayout(src(9, 4), addMargin(initialAdjust(src(9, 4)), 'right', pxToMm(2, 600)));
    const d1 = decodeRaw(await exportPngLossless(readPngInfo(g16.png), l1, 'white'));
    expect(d1.info).toMatchObject({ width: 11, bitDepth: 16, colorType: 0 });
    expect(Array.from(d1.raw.subarray(0, 18))).toEqual(Array.from(g16.raw.subarray(0, 18)));
    expect(Array.from(d1.raw.subarray(18, 22))).toEqual([255, 255, 255, 255]);

    const rgba = makePng(6, 3, 6, 8);
    const l2 = computeLayout(src(6, 3), addMargin(initialAdjust(src(6, 3)), 'left', pxToMm(1, 600)));
    const d2 = decodeRaw(await exportPngLossless(readPngInfo(rgba.png), l2, 'transparent'));
    expect(Array.from(d2.raw.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(d2.raw.subarray(4, 8))).toEqual(Array.from(rgba.raw.subarray(0, 4)));
  });
});
