/**
 * Shared coordinate model for preview AND export.
 *
 * Coordinate system: millimetres, origin at the top-left corner of the paper,
 * x to the right, y downwards. The "content" is the loaded artwork (PNG image
 * or PDF page). Its top-left corner sits at (offsetXmm, offsetYmm) on the paper
 * and its size is its natural physical size multiplied by scaleX / scaleY.
 *
 * Margins are *derived* from paper size, offset and content size:
 *   left   = offsetX
 *   right  = paperWidth  - offsetX - contentWidth
 *   top    = offsetY
 *   bottom = paperHeight - offsetY - contentHeight
 * A negative margin means the content is cropped on that side.
 *
 * `computeLayout` is the single place where the state is turned into concrete
 * positions. The preview renders from its result, and both exporters
 * (pngUtils / pdfUtils) consume the same result, so preview and output cannot
 * disagree.
 */
import { mmToPt, mmToPx, pxToMm } from './units';

export type SourceKind = 'png' | 'pdf';

export interface SourceGeometry {
  kind: SourceKind;
  /** Natural size of the content in mm (for PDF: as displayed, i.e. after /Rotate). */
  widthMm: number;
  heightMm: number;
  /** PNG only: pixel dimensions of the image. */
  pixelWidth?: number;
  pixelHeight?: number;
  /** PNG: resolution of the image. PDF: reference resolution used only for px display. */
  dpi: number;
}

export interface Adjust {
  paperWidthMm: number;
  paperHeightMm: number;
  /** Position of the content's top-left corner relative to the paper's top-left corner. */
  offsetXmm: number;
  offsetYmm: number;
  /** 1 = 100 %. */
  scaleX: number;
  scaleY: number;
  /** Accumulated displacement from "move" operations (for reporting only). */
  moveXmm: number;
  moveYmm: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Margins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type Side = keyof Margins;
export const SIDES: Side[] = ['top', 'bottom', 'left', 'right'];

export interface RasterLayout {
  dpi: number;
  /** Output canvas size in px. */
  canvasWidth: number;
  canvasHeight: number;
  /** Destination rectangle of the source image in px (integers). */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  /** True when dw/dh differ from the source pixel size (i.e. the image is resampled). */
  resampled: boolean;
}

export interface Layout {
  /** Requested paper size (exact, used for PDF MediaBox). */
  paperWidthMm: number;
  paperHeightMm: number;
  /** Content rectangle on the paper in mm (for PNG sources: snapped to the pixel grid). */
  content: Rect;
  margins: Margins;
  /** Pixel layout for PNG sources; null for PDF sources. */
  raster: RasterLayout | null;
}

export interface PdfPlacement {
  pageWidthPt: number;
  pageHeightPt: number;
  /** Lower-left corner and size of the content in PDF user space (y up). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_PAPER_MM = 1;
export const MAX_PAPER_MM = 5000; // PDF user space limit is 14400 pt ≈ 5080 mm

/** Scaled pixel size; at scale 1 this is exactly the source size (no resampling). */
function scaledPixels(px: number, scale: number): number {
  return scale === 1 ? px : Math.max(1, Math.round(px * scale));
}

/** Exact (unsnapped) content size in mm. */
export function contentSizeMm(src: SourceGeometry, adj: Adjust): { width: number; height: number } {
  return { width: src.widthMm * adj.scaleX, height: src.heightMm * adj.scaleY };
}

/** Exact (unsnapped) margins, used by editing operations. */
export function exactMargins(src: SourceGeometry, adj: Adjust): Margins {
  const c = contentSizeMm(src, adj);
  return {
    left: adj.offsetXmm,
    top: adj.offsetYmm,
    right: adj.paperWidthMm - adj.offsetXmm - c.width,
    bottom: adj.paperHeightMm - adj.offsetYmm - c.height,
  };
}

export function computeLayout(src: SourceGeometry, adj: Adjust): Layout {
  let content: Rect;
  let raster: RasterLayout | null = null;

  if (src.kind === 'png') {
    if (src.pixelWidth === undefined || src.pixelHeight === undefined) {
      throw new Error('PNG source requires pixel dimensions');
    }
    const dpi = src.dpi;
    const dw = scaledPixels(src.pixelWidth, adj.scaleX);
    const dh = scaledPixels(src.pixelHeight, adj.scaleY);
    const dx = Math.round(mmToPx(adj.offsetXmm, dpi));
    const dy = Math.round(mmToPx(adj.offsetYmm, dpi));
    raster = {
      dpi,
      canvasWidth: Math.max(1, Math.round(mmToPx(adj.paperWidthMm, dpi))),
      canvasHeight: Math.max(1, Math.round(mmToPx(adj.paperHeightMm, dpi))),
      dx,
      dy,
      dw,
      dh,
      resampled: dw !== src.pixelWidth || dh !== src.pixelHeight,
    };
    content = { x: pxToMm(dx, dpi), y: pxToMm(dy, dpi), width: pxToMm(dw, dpi), height: pxToMm(dh, dpi) };
  } else {
    const c = contentSizeMm(src, adj);
    content = { x: adj.offsetXmm, y: adj.offsetYmm, width: c.width, height: c.height };
  }

  // For PNG sources the margins are those of the actual pixel raster (integers),
  // so sub-pixel rounding never shows up as a phantom crop.
  const margins: Margins = raster
    ? {
        left: pxToMm(raster.dx, raster.dpi),
        top: pxToMm(raster.dy, raster.dpi),
        right: pxToMm(raster.canvasWidth - raster.dx - raster.dw, raster.dpi),
        bottom: pxToMm(raster.canvasHeight - raster.dy - raster.dh, raster.dpi),
      }
    : {
        left: content.x,
        top: content.y,
        right: adj.paperWidthMm - content.x - content.width,
        bottom: adj.paperHeightMm - content.y - content.height,
      };

  return { paperWidthMm: adj.paperWidthMm, paperHeightMm: adj.paperHeightMm, content, margins, raster };
}

/** Converts a layout to PDF user space (points, origin bottom-left, y up). */
export function toPdfPlacement(layout: Layout): PdfPlacement {
  const pageWidthPt = mmToPt(layout.paperWidthMm);
  const pageHeightPt = mmToPt(layout.paperHeightMm);
  const c = layout.content;
  return {
    pageWidthPt,
    pageHeightPt,
    x: mmToPt(c.x),
    y: pageHeightPt - mmToPt(c.y + c.height),
    width: mmToPt(c.width),
    height: mmToPt(c.height),
  };
}

// ---------------------------------------------------------------------------
// Editing operations. All are pure: they return a new Adjust.
// ---------------------------------------------------------------------------

export function initialAdjust(src: SourceGeometry): Adjust {
  return {
    paperWidthMm: src.widthMm,
    paperHeightMm: src.heightMm,
    offsetXmm: 0,
    offsetYmm: 0,
    scaleX: 1,
    scaleY: 1,
    moveXmm: 0,
    moveYmm: 0,
  };
}

/** Adds (delta > 0) or removes (delta < 0) margin on one side; the paper grows/shrinks accordingly. */
export function addMargin(adj: Adjust, side: Side, deltaMm: number): Adjust {
  switch (side) {
    case 'left':
      return { ...adj, paperWidthMm: adj.paperWidthMm + deltaMm, offsetXmm: adj.offsetXmm + deltaMm };
    case 'right':
      return { ...adj, paperWidthMm: adj.paperWidthMm + deltaMm };
    case 'top':
      return { ...adj, paperHeightMm: adj.paperHeightMm + deltaMm, offsetYmm: adj.offsetYmm + deltaMm };
    case 'bottom':
      return { ...adj, paperHeightMm: adj.paperHeightMm + deltaMm };
  }
}

/** Sets one margin to an absolute value (negative = crop); the paper size changes. */
export function setMargin(src: SourceGeometry, adj: Adjust, side: Side, valueMm: number): Adjust {
  const current = exactMargins(src, adj)[side];
  return addMargin(adj, side, valueMm - current);
}

/** Sets all four margins to the same value; the paper size changes. */
export function setAllMargins(src: SourceGeometry, adj: Adjust, valueMm: number): Adjust {
  const c = contentSizeMm(src, adj);
  return {
    ...adj,
    paperWidthMm: c.width + 2 * valueMm,
    paperHeightMm: c.height + 2 * valueMm,
    offsetXmm: valueMm,
    offsetYmm: valueMm,
  };
}

/** Moves the content within the paper. Paper size is unchanged. */
export function moveContent(adj: Adjust, dxMm: number, dyMm: number): Adjust {
  return {
    ...adj,
    offsetXmm: adj.offsetXmm + dxMm,
    offsetYmm: adj.offsetYmm + dyMm,
    moveXmm: adj.moveXmm + dxMm,
    moveYmm: adj.moveYmm + dyMm,
  };
}

/** Makes left and right margins equal by moving the content (paper size unchanged). */
export function equalizeHorizontal(src: SourceGeometry, adj: Adjust): Adjust {
  const c = contentSizeMm(src, adj);
  const target = (adj.paperWidthMm - c.width) / 2;
  return moveContent(adj, target - adj.offsetXmm, 0);
}

/** Makes top and bottom margins equal by moving the content (paper size unchanged). */
export function equalizeVertical(src: SourceGeometry, adj: Adjust): Adjust {
  const c = contentSizeMm(src, adj);
  const target = (adj.paperHeightMm - c.height) / 2;
  return moveContent(adj, 0, target - adj.offsetYmm);
}

/** Centers the content on the paper (no scaling, paper size unchanged). */
export function centerContent(src: SourceGeometry, adj: Adjust): Adjust {
  return equalizeVertical(src, equalizeHorizontal(src, adj));
}

export type PaperAnchor = 'center' | 'top-left';

/**
 * Changes the paper size. With anchor 'center' the size change is distributed
 * equally to both sides (content keeps its position relative to the paper center);
 * with 'top-left' the content keeps its distance to the top-left corner.
 */
export function setPaperSize(adj: Adjust, widthMm: number, heightMm: number, anchor: PaperAnchor): Adjust {
  const dw = widthMm - adj.paperWidthMm;
  const dh = heightMm - adj.paperHeightMm;
  return {
    ...adj,
    paperWidthMm: widthMm,
    paperHeightMm: heightMm,
    offsetXmm: anchor === 'center' ? adj.offsetXmm + dw / 2 : adj.offsetXmm,
    offsetYmm: anchor === 'center' ? adj.offsetYmm + dh / 2 : adj.offsetYmm,
  };
}

/** Scales the content around its own center. Paper size is unchanged. */
export function setScale(src: SourceGeometry, adj: Adjust, scaleX: number, scaleY: number): Adjust {
  const old = contentSizeMm(src, adj);
  const cx = adj.offsetXmm + old.width / 2;
  const cy = adj.offsetYmm + old.height / 2;
  const w = src.widthMm * scaleX;
  const h = src.heightMm * scaleY;
  return { ...adj, scaleX, scaleY, offsetXmm: cx - w / 2, offsetYmm: cy - h / 2 };
}

/** Returns an error message if the adjust would produce an invalid output, otherwise null. */
export function validateAdjust(src: SourceGeometry, adj: Adjust): string | null {
  const vals = Object.values(adj);
  if (vals.some((v) => !Number.isFinite(v))) return '数値が不正です。';
  if (adj.paperWidthMm < MIN_PAPER_MM || adj.paperHeightMm < MIN_PAPER_MM) {
    return `用紙サイズは ${MIN_PAPER_MM} mm 以上にしてください。`;
  }
  if (adj.paperWidthMm > MAX_PAPER_MM || adj.paperHeightMm > MAX_PAPER_MM) {
    return `用紙サイズは ${MAX_PAPER_MM} mm 以下にしてください。`;
  }
  if (adj.scaleX <= 0 || adj.scaleY <= 0 || adj.scaleX > 10 || adj.scaleY > 10) {
    return '拡大率は 0 より大きく 1000% 以下にしてください。';
  }
  if (src.kind === 'png') {
    const r = computeLayout(src, adj).raster!;
    if (r.canvasWidth > 32767 || r.canvasHeight > 32767 || r.canvasWidth * r.canvasHeight > 268_000_000) {
      return '出力画像が大きすぎます（ブラウザのCanvas上限を超えます）。';
    }
  }
  return null;
}
