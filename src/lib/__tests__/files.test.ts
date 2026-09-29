import { deflateSync } from 'node:zlib';
import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { computeLayout, initialAdjust, moveContent, setPaperSize, toPdfPlacement, type SourceGeometry } from '../geometry';
import { contentMatrix, createCalibrationPdf, exportPdfFromPdf, exportPdfFromPng } from '../pdfUtils';
import { crc32, makePhysChunk, parseChunks, readPngInfo, setPngDpi } from '../pngUtils';
import { mmToPt, pxToMm } from '../units';

/** Builds a minimal RGB PNG (filter 0 on every row). */
function makePng(width: number, height: number, dpi?: number): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width * 3; x++) raw[y * (width * 3 + 1) + 1 + x] = (x + y) & 0xff;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(dpi ? [makePhysChunk(dpi)] : []),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function mediaBox(doc: PDFDocument) {
  const mb = doc.getPage(0).node.MediaBox();
  return [0, 1, 2, 3].map((i) => (mb.lookup(i) as PDFNumber).asNumber());
}

describe('PNG chunks', () => {
  it('crc32 of "IEND" is AE426082', () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });

  it('reads DPI from pHYs', () => {
    expect(readPngInfo(makePng(4, 3, 600)).dpi).toBe(600);
    expect(readPngInfo(makePng(4, 3, 300)).dpi).toBe(300);
    expect(readPngInfo(makePng(4, 3)).dpi).toBeNull();
  });

  it('setPngDpi inserts pHYs after IHDR and keeps image data', () => {
    const src = makePng(10, 5);
    const out = setPngDpi(src, 600);
    const chunks = parseChunks(out);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    const phys = new DataView(chunks[1].data.buffer, chunks[1].data.byteOffset, 9);
    expect(phys.getUint32(0)).toBe(23622);
    expect(phys.getUint32(4)).toBe(23622);
    expect(chunks[1].data[8]).toBe(1);
    expect(readPngInfo(out).idat).toEqual(readPngInfo(src).idat);
    // every CRC must be valid
    for (const c of chunks) {
      const crc = new DataView(out.buffer).getUint32(c.offset + c.size - 4);
      expect(crc32(out, c.offset + 4, c.offset + c.size - 4)).toBe(crc);
    }
  });

  it('setPngDpi replaces an existing pHYs', () => {
    const out = setPngDpi(makePng(2, 2, 72), 600);
    const types = parseChunks(out).map((c) => c.type);
    expect(types.filter((t) => t === 'pHYs')).toHaveLength(1);
    expect(readPngInfo(out).dpi).toBe(600);
  });
});

describe('PDF export', () => {
  it('PNG → PDF has exact page size and embeds IDAT verbatim', async () => {
    const png = makePng(600, 300, 600); // 25.4 × 12.7 mm
    const info = readPngInfo(png);
    const src: SourceGeometry = {
      kind: 'png',
      pixelWidth: 600,
      pixelHeight: 300,
      dpi: 600,
      widthMm: pxToMm(600, 600),
      heightMm: pxToMm(300, 600),
    };
    const adj = setPaperSize(initialAdjust(src), 210, 297, 'top-left');
    const bytes = await exportPdfFromPng(png, info, computeLayout(src, adj));
    const doc = await PDFDocument.load(bytes);
    const [x0, y0, x1, y1] = mediaBox(doc);
    expect(x0).toBe(0);
    expect(y0).toBe(0);
    expect(x1).toBeCloseTo(mmToPt(210), 4);
    expect(y1).toBeCloseTo(mmToPt(297), 4);

    const images = doc.context
      .enumerateIndirectObjects()
      .map(([, o]) => o)
      .filter((o): o is PDFRawStream => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
    expect(images).toHaveLength(1);
    expect(Array.from(images[0].contents)).toEqual(Array.from(info.idat));
  });

  it('PDF → PDF changes MediaBox and keeps content as a form XObject', async () => {
    const srcDoc = await PDFDocument.create();
    const p = srcDoc.addPage([mmToPt(210), mmToPt(297)]);
    p.drawRectangle({ x: 10, y: 10, width: 100, height: 100 });
    const srcBytes = await srcDoc.save();

    const src: SourceGeometry = { kind: 'pdf', widthMm: 210, heightMm: 297, dpi: 600 };
    const adj = moveContent(setPaperSize(initialAdjust(src), 216.3, 300, 'top-left'), 3.15, 1.5);
    const out = await PDFDocument.load(await exportPdfFromPdf(srcBytes, 0, computeLayout(src, adj)));
    const [, , w, h] = mediaBox(out);
    expect(w).toBeCloseTo(mmToPt(216.3), 4);
    expect(h).toBeCloseTo(mmToPt(300), 4);

    const xobjects = out.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'));
    expect(xobjects).toBeDefined();
    const forms = out.context
      .enumerateIndirectObjects()
      .map(([, o]) => o)
      .filter((o) => 'dict' in (o as object) && (o as PDFRawStream).dict.get(PDFName.of('Subtype')) === PDFName.of('Form'));
    expect(forms).toHaveLength(1);
    const bbox = (forms[0] as PDFRawStream).dict.lookup(PDFName.of('BBox'), PDFArray);
    expect((bbox.lookup(2) as PDFNumber).asNumber()).toBeCloseTo(mmToPt(210), 4);
  });

  it('calibration PDF has the requested page size', async () => {
    const doc = await PDFDocument.load(await createCalibrationPdf(210, 297));
    const [, , w, h] = mediaBox(doc);
    expect(w).toBeCloseTo(mmToPt(210), 4);
    expect(h).toBeCloseTo(mmToPt(297), 4);
  });
});

describe('contentMatrix', () => {
  const apply = (m: number[], x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const src: SourceGeometry = { kind: 'pdf', widthMm: 297, heightMm: 210, dpi: 600 };
  const placement = toPdfPlacement(computeLayout(src, moveContent(initialAdjust(src), 5, 5)));

  it.each([0, 90, 180, 270])('rotation %i maps the form onto the target rectangle', (rot) => {
    // form size in unrotated orientation
    const swap = rot === 90 || rot === 270;
    const fw = swap ? placement.height : placement.width;
    const fh = swap ? placement.width : placement.height;
    const m = contentMatrix(placement, rot, fw, fh);
    const corners = [apply(m, 0, 0), apply(m, fw, 0), apply(m, 0, fh), apply(m, fw, fh)];
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    expect(Math.min(...xs)).toBeCloseTo(placement.x, 9);
    expect(Math.max(...xs)).toBeCloseTo(placement.x + placement.width, 9);
    expect(Math.min(...ys)).toBeCloseTo(placement.y, 9);
    expect(Math.max(...ys)).toBeCloseTo(placement.y + placement.height, 9);
  });

  it('rotation 90 puts the form origin at the top-left (clockwise)', () => {
    const fw = placement.height;
    const fh = placement.width;
    const m = contentMatrix(placement, 90, fw, fh);
    const [x, y] = apply(m, 0, 0);
    expect(x).toBeCloseTo(placement.x, 9);
    expect(y).toBeCloseTo(placement.y + placement.height, 9);
  });
});
