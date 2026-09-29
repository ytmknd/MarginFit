/**
 * PNG binary handling: chunk parsing, pHYs (DPI) read/write and lossless export.
 *
 * PNG layout: 8-byte signature, then chunks of
 *   length (u32 BE) | type (4 ASCII) | data (length bytes) | CRC32 (u32 BE, over type+data)
 *
 * pHYs data (9 bytes): ppuX (u32) | ppuY (u32) | unit (u8, 1 = metre).
 */
import type { Layout } from './geometry';
import { dpiToPpm, ppmToNominalDpi } from './units';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// ---------------------------------------------------------------------------
// CRC32 (ISO-HDLC, as used by PNG and zlib)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Chunk parsing
// ---------------------------------------------------------------------------
export interface PngChunk {
  type: string;
  /** Offset of the chunk's length field within the file. */
  offset: number;
  /** Total size of the chunk including length, type and CRC. */
  size: number;
  data: Uint8Array;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

export function parseChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new Error('PNGファイルではありません。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const dataStart = pos + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new Error(`PNGチャンク ${type} が途中で切れています。`);
    chunks.push({ type, offset: pos, size: length + 12, data: bytes.subarray(dataStart, dataEnd) });
    pos = dataEnd + 4;
    if (type === 'IEND') break;
  }
  if (chunks.length === 0 || chunks[0].type !== 'IHDR') throw new Error('PNGのIHDRチャンクがありません。');
  return chunks;
}

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  /** 0 gray, 2 RGB, 3 palette, 4 gray+alpha, 6 RGBA */
  colorType: number;
  interlace: number;
  /** DPI from pHYs (unit = metre), or null if absent / aspect-only. */
  dpi: number | null;
  dpiY: number | null;
  ppmX: number | null;
  ppmY: number | null;
  hasTransparency: boolean;
  /** PLTE data (palette images only). */
  palette: Uint8Array | null;
  /** tRNS data, if any. */
  trns: Uint8Array | null;
  /** Colour-related chunks (PLTE, tRNS, gAMA, cHRM, sRGB, iCCP, sBIT) to carry over on re-encode. */
  colorChunks: { type: string; data: Uint8Array }[];
  /** Concatenated IDAT data (zlib stream). */
  idat: Uint8Array;
}

const COLOR_CHUNKS = ['PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT'];

export function readPngInfo(bytes: Uint8Array): PngInfo {
  const chunks = parseChunks(bytes);
  const ihdr = chunks[0].data;
  const v = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
  const colorType = ihdr[9];
  let ppmX: number | null = null;
  let ppmY: number | null = null;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const colorChunks: { type: string; data: Uint8Array }[] = [];
  const idatParts: Uint8Array[] = [];

  for (const c of chunks) {
    if (c.type === 'pHYs' && c.data.length === 9) {
      const pv = new DataView(c.data.buffer, c.data.byteOffset, 9);
      if (c.data[8] === 1) {
        ppmX = pv.getUint32(0);
        ppmY = pv.getUint32(4);
      }
    } else if (c.type === 'IDAT') {
      idatParts.push(c.data);
    }
    if (c.type === 'PLTE') palette = c.data;
    if (c.type === 'tRNS') trns = c.data;
    if (COLOR_CHUNKS.includes(c.type)) colorChunks.push({ type: c.type, data: c.data });
  }

  const idatLen = idatParts.reduce((s, p) => s + p.length, 0);
  const idat = new Uint8Array(idatLen);
  let o = 0;
  for (const p of idatParts) {
    idat.set(p, o);
    o += p.length;
  }

  return {
    width: v.getUint32(0),
    height: v.getUint32(4),
    bitDepth: ihdr[8],
    colorType,
    interlace: ihdr[12],
    ppmX,
    ppmY,
    dpi: ppmX ? ppmToNominalDpi(ppmX) : null,
    dpiY: ppmY ? ppmToNominalDpi(ppmY) : null,
    hasTransparency: colorType === 4 || colorType === 6 || trns !== null,
    palette,
    trns,
    colorChunks,
    idat,
  };
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

export function makePhysChunk(dpi: number): Uint8Array {
  const ppm = dpiToPpm(dpi);
  const data = new Uint8Array(9);
  const v = new DataView(data.buffer);
  v.setUint32(0, ppm);
  v.setUint32(4, ppm);
  data[8] = 1; // unit: metre
  return makeChunk('pHYs', data);
}

/**
 * Returns a copy of the PNG with its pHYs chunk set to `dpi`
 * (any existing pHYs is removed; the new one is inserted directly after IHDR,
 * which satisfies the "before IDAT" ordering rule). Image data is untouched.
 */
export function setPngDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const chunks = parseChunks(bytes);
  const phys = makePhysChunk(dpi);
  const kept = chunks.filter((c) => c.type !== 'pHYs');
  const total = 8 + phys.length + kept.reduce((s, c) => s + c.size, 0);
  const out = new Uint8Array(total);
  out.set(bytes.subarray(0, 8), 0);
  let pos = 8;
  for (const c of kept) {
    out.set(bytes.subarray(c.offset, c.offset + c.size), pos);
    pos += c.size;
    if (c.type === 'IHDR') {
      out.set(phys, pos);
      pos += phys.length;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scanline codec (uses the browser's / Node's native zlib streams)
// ---------------------------------------------------------------------------

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

async function pipeThrough(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** zlib inflate / deflate. PNG IDAT uses the zlib wrapper, which is what "deflate" means in Compression Streams. */
export const inflate = (data: Uint8Array) => pipeThrough(data, new DecompressionStream('deflate'));
export const deflate = (data: Uint8Array) => pipeThrough(data, new CompressionStream('deflate'));

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reverses PNG row filters. Input: height × (1 + rowBytes); output: height × rowBytes. */
export function unfilter(filtered: Uint8Array, height: number, rowBytes: number, bpp: number): Uint8Array {
  if (filtered.length < height * (rowBytes + 1)) throw new Error('PNG画像データが不足しています。');
  const out = new Uint8Array(height * rowBytes);
  for (let y = 0; y < height; y++) {
    const ft = filtered[y * (rowBytes + 1)];
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    const prev = dst - rowBytes;
    switch (ft) {
      case 0:
        out.set(filtered.subarray(src, src + rowBytes), dst);
        break;
      case 1:
        for (let i = 0; i < rowBytes; i++) out[dst + i] = (filtered[src + i] + (i >= bpp ? out[dst + i - bpp] : 0)) & 0xff;
        break;
      case 2:
        for (let i = 0; i < rowBytes; i++) out[dst + i] = (filtered[src + i] + (y > 0 ? out[prev + i] : 0)) & 0xff;
        break;
      case 3:
        for (let i = 0; i < rowBytes; i++) {
          const a = i >= bpp ? out[dst + i - bpp] : 0;
          const b = y > 0 ? out[prev + i] : 0;
          out[dst + i] = (filtered[src + i] + ((a + b) >> 1)) & 0xff;
        }
        break;
      case 4:
        for (let i = 0; i < rowBytes; i++) {
          const a = i >= bpp ? out[dst + i - bpp] : 0;
          const b = y > 0 ? out[prev + i] : 0;
          const c = y > 0 && i >= bpp ? out[prev + i - bpp] : 0;
          out[dst + i] = (filtered[src + i] + paeth(a, b, c)) & 0xff;
        }
        break;
      default:
        throw new Error(`不明なPNGフィルタ種別 ${ft}`);
    }
  }
  return out;
}

/**
 * Applies PNG row filters, choosing per row the filter with the smallest sum
 * of absolute (signed) residuals — the standard libpng heuristic.
 */
export function filterRows(raw: Uint8Array, height: number, rowBytes: number, bpp: number): Uint8Array {
  const out = new Uint8Array(height * (rowBytes + 1));
  const cand = Array.from({ length: 5 }, () => new Uint8Array(rowBytes));
  for (let y = 0; y < height; y++) {
    const cur = y * rowBytes;
    const prev = cur - rowBytes;
    let best = 0;
    let bestSum = Infinity;
    for (let ft = 0; ft < 5; ft++) {
      const c = cand[ft];
      let sum = 0;
      let i = 0;
      for (; i < rowBytes; i++) {
        const x = raw[cur + i];
        const a = i >= bpp ? raw[cur + i - bpp] : 0;
        const b = y > 0 ? raw[prev + i] : 0;
        let v: number;
        if (ft === 0) v = x;
        else if (ft === 1) v = x - a;
        else if (ft === 2) v = x - b;
        else if (ft === 3) v = x - ((a + b) >> 1);
        else v = x - paeth(a, b, y > 0 && i >= bpp ? raw[prev + i - bpp] : 0);
        v &= 0xff;
        c[i] = v;
        sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break; // cannot win; only fully computed rows can be chosen
      }
      if (i === rowBytes && sum < bestSum) {
        bestSum = sum;
        best = ft;
      }
    }
    const o = y * (rowBytes + 1);
    out[o] = best;
    out.set(cand[best], o + 1);
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export type Background = 'white' | 'transparent';

/**
 * Bytes of one background pixel in the source's own pixel format, or null if
 * the background cannot be expressed without changing the colour type.
 */
export function backgroundPixel(info: PngInfo, background: Background): Uint8Array | null {
  const ch = CHANNELS[info.colorType];
  if (ch === undefined || info.bitDepth < 8) return null;
  const bpp = (ch * info.bitDepth) / 8;
  if (info.colorType === 3) {
    const pal = info.palette;
    if (!pal) return null;
    for (let i = 0; i < pal.length / 3; i++) {
      const alpha = info.trns && i < info.trns.length ? info.trns[i] : 255;
      const white = pal[i * 3] === 255 && pal[i * 3 + 1] === 255 && pal[i * 3 + 2] === 255;
      if (background === 'white' ? white && alpha === 255 : alpha === 0) return new Uint8Array([i]);
    }
    return null;
  }
  if (background === 'white') {
    // Gray/RGB tRNS is a colour key; if the key is white, white would become transparent.
    if (info.trns && (info.colorType === 0 || info.colorType === 2)) {
      const v = new DataView(info.trns.buffer, info.trns.byteOffset, info.trns.byteLength);
      const max = 2 ** info.bitDepth - 1;
      let keyIsWhite = true;
      for (let i = 0; i + 1 < info.trns.length; i += 2) if (v.getUint16(i) !== max) keyIsWhite = false;
      if (keyIsWhite) return null;
    }
    // White (with opaque alpha, if present) is every bit set in every channel.
    return new Uint8Array(bpp).fill(0xff);
  }
  // Transparent requires an alpha channel.
  if (info.colorType === 4 || info.colorType === 6) return new Uint8Array(bpp);
  return null;
}

/** True if exportPngLossless can handle this image and layout. */
export function canExportLossless(info: PngInfo, layout: Layout, background: Background): boolean {
  const r = layout.raster;
  return !!r && !r.resampled && info.interlace === 0 && backgroundPixel(info, background) !== null;
}

/**
 * Lossless PNG export: the source scanlines are inflated, copied byte-for-byte
 * into a raster of the adjusted size (padded with the background colour, or
 * cropped), then re-filtered and re-compressed. The colour type, bit depth,
 * palette and colour-management chunks of the source are preserved and a pHYs
 * chunk with the DPI is written. No canvas, no colour conversion, no resampling.
 */
export async function exportPngLossless(info: PngInfo, layout: Layout, background: Background): Promise<Uint8Array> {
  const r = layout.raster;
  const bg = backgroundPixel(info, background);
  if (!r || !bg || !canExportLossless(info, layout, background)) throw new Error('この画像はロスレス直接出力に対応していません。');
  const bpp = bg.length;
  const srcRow = info.width * bpp;
  const src = unfilter(await inflate(info.idat), info.height, srcRow, bpp);

  const W = r.canvasWidth;
  const H = r.canvasHeight;
  const dstRow = W * bpp;
  const raw = new Uint8Array(dstRow * H);
  const bgRow = new Uint8Array(dstRow);
  for (let i = 0; i < dstRow; i += bpp) bgRow.set(bg, i);

  // Horizontal overlap of the source with the output, in output pixels.
  const x0 = Math.max(0, r.dx);
  const x1 = Math.min(W, r.dx + info.width);
  for (let y = 0; y < H; y++) {
    raw.set(bgRow, y * dstRow);
    const sy = y - r.dy;
    if (sy < 0 || sy >= info.height || x1 <= x0) continue;
    const s = sy * srcRow + (x0 - r.dx) * bpp;
    raw.set(src.subarray(s, s + (x1 - x0) * bpp), y * dstRow + x0 * bpp);
  }

  const idat = await deflate(filterRows(raw, H, dstRow, bpp));

  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, W);
  iv.setUint32(4, H);
  ihdr[8] = info.bitDepth;
  ihdr[9] = info.colorType;
  // compression 0, filter method 0, interlace 0

  const parts: Uint8Array[] = [new Uint8Array(SIGNATURE), makeChunk('IHDR', ihdr), makePhysChunk(r.dpi)];
  // Colour chunks precede IDAT; their source order (PLTE before tRNS) is kept.
  for (const c of info.colorChunks) parts.push(makeChunk(c.type, c.data));
  const IDAT_CHUNK = 1 << 20;
  for (let o = 0; o < idat.length; o += IDAT_CHUNK) parts.push(makeChunk('IDAT', idat.subarray(o, o + IDAT_CHUNK)));
  parts.push(makeChunk('IEND', new Uint8Array(0)));
  return concat(parts);
}

// ---------------------------------------------------------------------------
// Canvas path (browser only) — used for resampling and formats not covered above
// ---------------------------------------------------------------------------

const DECODE_OPTIONS = {
  colorSpaceConversion: 'none',
  premultiplyAlpha: 'none',
  imageOrientation: 'none',
} as ImageBitmapOptions;

/**
 * Decodes the PNG without colour-space conversion or alpha premultiplication,
 * so that pixel values reach the canvas unchanged. With `resize`, produces a
 * smaller bitmap (used for the on-screen preview only).
 */
export function decodePng(blob: Blob, resize?: { width: number; height: number }): Promise<ImageBitmap> {
  return createImageBitmap(
    blob,
    resize ? { ...DECODE_OPTIONS, resizeWidth: resize.width, resizeHeight: resize.height, resizeQuality: 'high' } : DECODE_OPTIONS,
  );
}

async function exportPngCanvas(bytes: Uint8Array, layout: Layout, background: Background): Promise<Uint8Array> {
  const r = layout.raster!;
  const image = await decodePng(new Blob([bytes as BlobPart], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  try {
    canvas.width = r.canvasWidth;
    canvas.height = r.canvasHeight;
    const ctx = canvas.getContext('2d', { alpha: background === 'transparent' });
    if (!ctx) throw new Error('Canvasを初期化できません（画像が大きすぎる可能性があります）。');
    if (background === 'white') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, r.canvasWidth, r.canvasHeight);
    }
    if (r.resampled) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, r.dx, r.dy, r.dw, r.dh);
    } else {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, r.dx, r.dy);
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNGのエンコードに失敗しました（画像が大きすぎる可能性があります）。');
    return setPngDpi(new Uint8Array(await blob.arrayBuffer()), r.dpi);
  } finally {
    image.close();
    // Release the (potentially huge) backing store promptly.
    canvas.width = 0;
    canvas.height = 0;
  }
}

export interface PngExportResult {
  bytes: Uint8Array;
  /** 'lossless': byte-exact pixel copy; 'canvas': rendered through a canvas (8-bit RGBA). */
  method: 'lossless' | 'canvas';
}

/**
 * Renders the adjusted PNG with the source DPI in pHYs.
 * At scale 100 % the pixels are copied 1:1 via the lossless path; the canvas
 * is used only when the artwork is scaled or for formats that path does not
 * cover (interlaced, < 8 bit, background not representable).
 */
export async function exportPng(bytes: Uint8Array, info: PngInfo, layout: Layout, background: Background): Promise<PngExportResult> {
  if (!layout.raster) throw new Error('PNG出力にはピクセルレイアウトが必要です。');
  if (canExportLossless(info, layout, background)) {
    return { bytes: await losslessInWorker(info, layout, background), method: 'lossless' };
  }
  return { bytes: await exportPngCanvas(bytes, layout, background), method: 'canvas' };
}

/** Runs exportPngLossless in a Web Worker; falls back to the main thread if workers are unavailable. */
async function losslessInWorker(info: PngInfo, layout: Layout, background: Background): Promise<Uint8Array> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./pngWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    return exportPngLossless(info, layout, background);
  }
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }>) =>
        e.data.ok ? resolve(e.data.bytes) : reject(new Error(e.data.error));
      worker.onerror = (e) => reject(new Error(e.message || 'PNG出力ワーカーでエラーが発生しました。'));
      worker.postMessage({ info, layout, background });
    });
  } finally {
    worker.terminate();
  }
}
