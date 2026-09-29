/**
 * PDF output with pdf-lib.
 *
 * PDF → PDF: the source page is embedded as a Form XObject (its content
 * streams and resources are copied verbatim, i.e. vectors / text / images stay
 * as they are — nothing is rasterised). A new page with the requested
 * MediaBox is created and the form is drawn with a single transformation
 * matrix (translation, optional scale, and /Rotate compensation).
 *
 * PNG → PDF: when possible the PNG's compressed IDAT stream is copied directly
 * into an image XObject (FlateDecode + PNG predictors), which is lossless and
 * bit-exact. Images with transparency or interlacing fall back to pdf-lib's
 * embedPng (also lossless).
 */
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFRawStream,
  StandardFonts,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from 'pdf-lib';
import type { Layout, PdfPlacement } from './geometry';
import { toPdfPlacement } from './geometry';
import type { PngInfo } from './pngUtils';
import { mmToPt, ptToMm } from './units';

export type Matrix = [number, number, number, number, number, number];

export interface PdfPageInfo {
  pageCount: number;
  /** Visible box (CropBox, falling back to MediaBox) in the page's own coordinates. */
  box: { x: number; y: number; width: number; height: number };
  /** Normalised /Rotate: 0, 90, 180 or 270 (clockwise). */
  rotation: number;
  /** /UserUnit of the page: size of one user-space unit in multiples of 1/72 inch (default 1). */
  userUnit: number;
  /** Displayed size in pt (after rotation). */
  widthPt: number;
  heightPt: number;
  widthMm: number;
  heightMm: number;
}

export function normalizeRotation(angle: number): number {
  return (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
}

/** Reads /UserUnit (PDF 1.6). Scanners and converters use it for large pages. */
export function readUserUnit(page: PDFPage): number {
  const v = page.node.lookup(PDFName.of('UserUnit'));
  const n = v instanceof PDFNumber ? v.asNumber() : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function pageInfo(doc: PDFDocument, page: PDFPage): PdfPageInfo {
  const box = page.getCropBox();
  const rotation = normalizeRotation(page.getRotation().angle);
  const userUnit = readUserUnit(page);
  const swap = rotation === 90 || rotation === 270;
  // Physical size in points = user-space size × UserUnit.
  const widthPt = (swap ? box.height : box.width) * userUnit;
  const heightPt = (swap ? box.width : box.height) * userUnit;
  return {
    pageCount: doc.getPageCount(),
    box,
    rotation,
    userUnit,
    widthPt,
    heightPt,
    widthMm: ptToMm(widthPt),
    heightMm: ptToMm(heightPt),
  };
}

export async function loadPdfDocument(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(msg)) throw new Error('暗号化（パスワード保護）されたPDFには対応していません。');
    throw new Error(`PDFを読み込めません: ${msg}`);
  }
}

export function readPdfPageInfo(doc: PDFDocument, pageIndex: number): PdfPageInfo {
  return pageInfo(doc, doc.getPage(pageIndex));
}

/**
 * Matrix that maps an embedded page form (origin at its lower-left, size
 * formW × formH in its *unrotated* orientation) onto the target rectangle,
 * applying the page's /Rotate so the result looks like the source page does
 * in a viewer.
 */
export function contentMatrix(p: PdfPlacement, rotation: number, formW: number, formH: number): Matrix {
  const { x, y } = p;
  switch (rotation) {
    case 90: {
      // displayed width = formH, height = formW
      const sx = p.width / formH;
      const sy = p.height / formW;
      // (u, v) → (v, formW - u), then scale and translate
      return [0, -sy, sx, 0, x, y + sy * formW];
    }
    case 180: {
      const sx = p.width / formW;
      const sy = p.height / formH;
      return [-sx, 0, 0, -sy, x + sx * formW, y + sy * formH];
    }
    case 270: {
      const sx = p.width / formH;
      const sy = p.height / formW;
      // (u, v) → (formH - v, u)
      return [0, sy, -sx, 0, x + sx * formH, y];
    }
    default: {
      return [p.width / formW, 0, 0, p.height / formH, x, y];
    }
  }
}

function drawXObject(page: PDFPage, name: PDFName, m: Matrix) {
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m), drawObject(name), popGraphicsState());
}

function newOutputDocument(): Promise<PDFDocument> {
  return PDFDocument.create().then((doc) => {
    doc.setProducer('MarginFit');
    doc.setCreator('MarginFit');
    return doc;
  });
}

function addPage(doc: PDFDocument, p: PdfPlacement): PDFPage {
  const page = doc.addPage([p.pageWidthPt, p.pageHeightPt]);
  // Explicit boxes so every viewer uses exactly this size.
  page.setMediaBox(0, 0, p.pageWidthPt, p.pageHeightPt);
  page.setCropBox(0, 0, p.pageWidthPt, p.pageHeightPt);
  return page;
}

/** PDF → adjusted PDF without rasterisation. */
export async function exportPdfFromPdf(srcBytes: Uint8Array, pageIndex: number, layout: Layout): Promise<Uint8Array> {
  const src = await loadPdfDocument(srcBytes);
  const srcPage = src.getPage(pageIndex);
  const info = pageInfo(src, srcPage);

  const out = await newOutputDocument();
  const placement = toPdfPlacement(layout);
  const page = addPage(out, placement);

  const b = info.box;
  const embedded = await out.embedPage(srcPage, {
    left: b.x,
    bottom: b.y,
    right: b.x + b.width,
    top: b.y + b.height,
  });
  const name = page.node.newXObject('MFContent', embedded.ref);
  drawXObject(page, name, contentMatrix(placement, info.rotation, embedded.width, embedded.height));

  return out.save({ useObjectStreams: true });
}

/** Builds an image XObject that reuses the PNG's IDAT stream verbatim, or null if not possible. */
function directPngXObject(doc: PDFDocument, png: PngInfo) {
  if (png.interlace !== 0 || png.hasTransparency) return null;
  let colorSpace: unknown;
  let colors: number;
  if (png.colorType === 0) {
    colorSpace = 'DeviceGray';
    colors = 1;
  } else if (png.colorType === 2) {
    colorSpace = 'DeviceRGB';
    colors = 3;
  } else if (png.colorType === 3 && png.palette) {
    let hex = '';
    for (const byte of png.palette) hex += byte.toString(16).padStart(2, '0');
    colorSpace = [PDFName.of('Indexed'), PDFName.of('DeviceRGB'), png.palette.length / 3 - 1, PDFHexString.of(hex)];
    colors = 1;
  } else {
    return null;
  }
  const ctx = doc.context;
  const dict = ctx.obj({
    Type: 'XObject',
    Subtype: 'Image',
    Width: png.width,
    Height: png.height,
    ColorSpace: colorSpace as never,
    BitsPerComponent: png.bitDepth,
    Filter: 'FlateDecode',
    DecodeParms: { Predictor: 15, Colors: colors, BitsPerComponent: png.bitDepth, Columns: png.width },
    Length: png.idat.length,
  });
  return ctx.register(PDFRawStream.of(dict, png.idat));
}

/** PNG → PDF with the exact physical paper size. */
export async function exportPdfFromPng(pngBytes: Uint8Array, png: PngInfo, layout: Layout): Promise<Uint8Array> {
  const out = await newOutputDocument();
  const placement = toPdfPlacement(layout);
  // White is the natural PDF paper colour, so the background is not painted.
  const page = addPage(out, placement);

  const ref = directPngXObject(out, png);
  if (ref) {
    const name = page.node.newXObject('MFImage', ref);
    drawXObject(page, name, [placement.width, 0, 0, placement.height, placement.x, placement.y]);
  } else {
    const img = await out.embedPng(pngBytes);
    page.drawImage(img, { x: placement.x, y: placement.y, width: placement.width, height: placement.height });
  }
  return out.save({ useObjectStreams: true });
}

/**
 * Generates a calibration sheet: 10 mm grid, 100 mm horizontal and vertical
 * rulers with 1 mm / 5 mm / 10 mm ticks, and a border inset 10 mm from the edge.
 */
export async function createCalibrationPdf(widthMm: number, heightMm: number): Promise<Uint8Array> {
  const doc = await newOutputDocument();
  doc.setTitle('MarginFit Calibration');
  const W = mmToPt(widthMm);
  const H = mmToPt(heightMm);
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const mm = (v: number) => mmToPt(v);
  // Convert top-left mm coordinates to PDF points.
  const X = (xmm: number) => mm(xmm);
  const Y = (ymm: number) => H - mm(ymm);
  const line = (x1: number, y1: number, x2: number, y2: number, t: number, c = rgb(0, 0, 0)) =>
    page.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: t, color: c });

  // 10 mm grid over the whole page
  const grid = rgb(0.78, 0.82, 0.88);
  for (let x = 0; x <= widthMm + 1e-9; x += 10) line(x, 0, x, heightMm, 0.3, grid);
  for (let y = 0; y <= heightMm + 1e-9; y += 10) line(0, y, widthMm, y, 0.3, grid);

  // Border 10 mm inset
  if (widthMm > 20 && heightMm > 20) {
    page.drawRectangle({
      x: X(10),
      y: Y(heightMm - 10),
      width: mm(widthMm - 20),
      height: mm(heightMm - 20),
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 0.5,
    });
  }

  const ox = 30;
  const oy = 40;
  const text = (s: string, xmm: number, ymm: number, size = 9) =>
    page.drawText(s, { x: X(xmm), y: Y(ymm), size, font, color: rgb(0, 0, 0) });

  // Horizontal 100 mm ruler
  if (widthMm >= ox + 110 && heightMm >= oy + 110) {
    line(ox, oy, ox + 100, oy, 0.6);
    for (let i = 0; i <= 100; i++) {
      const len = i % 10 === 0 ? 5 : i % 5 === 0 ? 3.5 : 2;
      line(ox + i, oy, ox + i, oy - len, 0.25);
      if (i % 10 === 0) text(String(i), ox + i - (i >= 100 ? 2.2 : i >= 10 ? 1.5 : 0.8), oy - 6.5, 7);
    }
    text('100 mm (horizontal)', ox + 35, oy + 6);

    // Vertical 100 mm ruler
    const vx = ox;
    const vy = oy + 10;
    line(vx, vy, vx, vy + 100, 0.6);
    for (let i = 0; i <= 100; i++) {
      const len = i % 10 === 0 ? 5 : i % 5 === 0 ? 3.5 : 2;
      line(vx, vy + i, vx - len, vy + i, 0.25);
      if (i % 10 === 0) text(String(i), vx - 13, vy + i + 1, 7);
    }
    text('100 mm (vertical)', vx + 4, vy + 50);
  }

  text('MarginFit Calibration Sheet', 15, 18, 12);
  text(
    `Page: ${widthMm.toFixed(1)} x ${heightMm.toFixed(1)} mm   Grid: 10 mm   Border: 10 mm from the paper edge`,
    15,
    24,
    8,
  );
  text('Print at 100% / Actual size (no "Fit to page"). Both lines must measure exactly 100.0 mm.', 15, 29, 8);

  return doc.save();
}
