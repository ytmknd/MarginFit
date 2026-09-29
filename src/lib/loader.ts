/**
 * File loading (browser only). Everything stays in memory; nothing is uploaded.
 */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { SourceGeometry } from './geometry';
import { loadPdfDocument, readPdfPageInfo, type PdfPageInfo } from './pdfUtils';
import { decodePng, isPng, readPngInfo, type PngInfo } from './pngUtils';
import { pxToMm } from './units';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const DEFAULT_DPI = 600;
/** Below this resolution a certificate background will look coarse when printed. */
export const LOW_DPI_WARNING = 200;
/** Resolution of the on-screen PDF preview bitmap (does not affect output). */
const PDF_PREVIEW_DPI = 200;
const PDF_PREVIEW_MAX_SIDE = 6000;
/**
 * Max side of the on-screen PNG preview bitmap. Full-resolution 600 dpi scans
 * (~35 MP) are never kept decoded in memory; export works from the PNG bytes.
 */
const PNG_PREVIEW_MAX_SIDE = 3000;

export interface LoadedPng {
  kind: 'png';
  fileName: string;
  bytes: Uint8Array;
  info: PngInfo;
  /** DPI found in the file's pHYs chunk, or null. */
  fileDpi: number | null;
  /** DPI in use (file DPI or user-specified). */
  dpi: number;
  previewUrl: string;
}

export interface LoadedPdf {
  kind: 'pdf';
  fileName: string;
  bytes: Uint8Array;
  pageIndex: number;
  page: PdfPageInfo;
  /** Reference DPI, used only to express sizes in px. */
  dpi: number;
  previewUrl: string;
}

export type LoadedFile = LoadedPng | LoadedPdf;

export function sourceGeometry(f: LoadedFile): SourceGeometry {
  if (f.kind === 'png') {
    return {
      kind: 'png',
      pixelWidth: f.info.width,
      pixelHeight: f.info.height,
      dpi: f.dpi,
      widthMm: pxToMm(f.info.width, f.dpi),
      heightMm: pxToMm(f.info.height, f.dpi),
    };
  }
  return { kind: 'pdf', widthMm: f.page.widthMm, heightMm: f.page.heightMm, dpi: f.dpi };
}

function isPdf(bytes: Uint8Array): boolean {
  // "%PDF" may be preceded by a little garbage; search the first 1 KB.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

export async function loadFile(file: File): Promise<LoadedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isPng(bytes)) return loadPng(file.name, bytes);
  if (isPdf(bytes)) return loadPdf(file.name, bytes, 0);
  throw new Error('PNG または PDF ファイルを選択してください。');
}

async function loadPng(fileName: string, bytes: Uint8Array): Promise<LoadedPng> {
  const info = readPngInfo(bytes);
  const blob = new Blob([bytes as BlobPart], { type: 'image/png' });
  const f = Math.min(1, PNG_PREVIEW_MAX_SIDE / Math.max(info.width, info.height));
  let previewUrl: string;
  if (f === 1) {
    previewUrl = URL.createObjectURL(blob);
  } else {
    const bmp = await decodePng(blob, { width: Math.max(1, Math.round(info.width * f)), height: Math.max(1, Math.round(info.height * f)) });
    previewUrl = await bitmapToUrl(bmp);
  }
  return {
    kind: 'png',
    fileName,
    bytes,
    info,
    fileDpi: info.dpi,
    dpi: info.dpi ?? DEFAULT_DPI,
    previewUrl,
  };
}

async function bitmapToUrl(bmp: ImageBitmap): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  canvas.width = 0;
  canvas.height = 0;
  if (!out) throw new Error('プレビューの生成に失敗しました（画像を読み込めません）。');
  return URL.createObjectURL(out);
}

export async function loadPdf(fileName: string, bytes: Uint8Array, pageIndex: number): Promise<LoadedPdf> {
  const doc = await loadPdfDocument(bytes);
  if (pageIndex < 0 || pageIndex >= doc.getPageCount()) throw new Error('ページ番号が範囲外です。');
  const page = readPdfPageInfo(doc, pageIndex);
  const previewUrl = await renderPdfPreview(bytes, pageIndex);
  return { kind: 'pdf', fileName, bytes, pageIndex, page, dpi: DEFAULT_DPI, previewUrl };
}

async function renderPdfPreview(bytes: Uint8Array, pageIndex: number): Promise<string> {
  // pdf.js may transfer the buffer to its worker, so give it a copy.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(pageIndex + 1);
    const base = page.getViewport({ scale: 1 });
    let scale = PDF_PREVIEW_DPI / 72;
    const side = Math.max(base.width, base.height) * scale;
    if (side > PDF_PREVIEW_MAX_SIDE) scale *= PDF_PREVIEW_MAX_SIDE / side;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // 'print' intent: shows the page as it prints, and does not depend on
    // requestAnimationFrame (which is paused in background tabs).
    await page.render({ canvas, canvasContext: ctx, viewport, intent: 'print' }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('PDFプレビューの生成に失敗しました。');
    return URL.createObjectURL(blob);
  } finally {
    await task.destroy();
  }
}

export function releaseFile(f: LoadedFile | null) {
  if (!f) return;
  URL.revokeObjectURL(f.previewUrl);
}
