import { describe, expect, it } from 'vitest';
import {
  a4For,
  fitDpiToPaper,
  isImplausibleSheetSize,
  addMargin,
  centerContent,
  computeLayout,
  equalizeHorizontal,
  initialAdjust,
  moveContent,
  setAllMargins,
  setMargin,
  setPaperSize,
  setScale,
  toPdfPlacement,
  type SourceGeometry,
} from '../geometry';
import { mmToPt, pxToMm } from '../units';

const png600: SourceGeometry = {
  kind: 'png',
  pixelWidth: 5102,
  pixelHeight: 7016,
  dpi: 600,
  widthMm: pxToMm(5102, 600),
  heightMm: pxToMm(7016, 600),
};
const pdfA4: SourceGeometry = { kind: 'pdf', widthMm: 210, heightMm: 297, dpi: 600 };

describe('computeLayout (PNG)', () => {
  it('initial layout is the image itself, 1:1 pixels', () => {
    const l = computeLayout(png600, initialAdjust(png600));
    expect(l.raster).toMatchObject({ canvasWidth: 5102, canvasHeight: 7016, dx: 0, dy: 0, dw: 5102, dh: 7016, resampled: false });
    expect(l.margins.left).toBe(0);
    expect(Math.abs(l.margins.right)).toBeLessThan(1e-9);
  });

  it('adding margins extends the canvas without resampling', () => {
    let a = initialAdjust(png600);
    a = addMargin(a, 'left', 2);
    a = addMargin(a, 'right', 2);
    const l = computeLayout(png600, a);
    // 4 mm at 600 dpi = 94.49 px
    expect(l.raster!.canvasWidth).toBe(5102 + 94);
    expect(l.raster!.dx).toBe(47);
    expect(l.raster!.dw).toBe(5102);
    expect(l.raster!.resampled).toBe(false);
  });

  it('negative margin crops', () => {
    const a = addMargin(initialAdjust(png600), 'top', -3);
    const l = computeLayout(png600, a);
    expect(l.raster!.dy).toBe(-71); // -3 mm = -70.87 px
    expect(l.raster!.canvasHeight).toBe(7016 - 71);
    expect(l.margins.top).toBeLessThan(0);
  });

  it('scaling resamples only when requested', () => {
    const a = setScale(png600, initialAdjust(png600), 0.998, 0.998);
    const l = computeLayout(png600, a);
    expect(l.raster!.resampled).toBe(true);
    expect(l.raster!.dw).toBe(Math.round(5102 * 0.998));
    expect(l.raster!.canvasWidth).toBe(5102); // paper unchanged
  });
});

describe('editing operations', () => {
  it('setMargin sets an absolute margin', () => {
    const a = setMargin(pdfA4, initialAdjust(pdfA4), 'left', 3);
    expect(a.paperWidthMm).toBeCloseTo(213, 12);
    expect(a.offsetXmm).toBeCloseTo(3, 12);
  });

  it('equalizeHorizontal keeps paper width and centers horizontally', () => {
    let a = addMargin(initialAdjust(pdfA4), 'left', 3);
    a = addMargin(a, 'right', 1);
    a = equalizeHorizontal(pdfA4, a);
    const l = computeLayout(pdfA4, a);
    expect(a.paperWidthMm).toBeCloseTo(214, 12);
    expect(l.margins.left).toBeCloseTo(2, 12);
    expect(l.margins.right).toBeCloseTo(2, 12);
    expect(a.moveXmm).toBeCloseTo(-1, 12);
  });

  it('setAllMargins', () => {
    const l = computeLayout(pdfA4, setAllMargins(pdfA4, initialAdjust(pdfA4), 5));
    expect(l.paperWidthMm).toBeCloseTo(220, 12);
    expect(l.paperHeightMm).toBeCloseTo(307, 12);
    for (const v of Object.values(l.margins)) expect(v).toBeCloseTo(5, 12);
  });

  it('setPaperSize with center anchor distributes the change', () => {
    const a = setPaperSize(initialAdjust(pdfA4), 216.3, 297, 'center');
    const l = computeLayout(pdfA4, a);
    expect(l.margins.left).toBeCloseTo(3.15, 12);
    expect(l.margins.right).toBeCloseTo(3.15, 12);
  });

  it('moving in 0.1 mm steps is exact', () => {
    let a = initialAdjust(pdfA4);
    for (let i = 0; i < 25; i++) a = moveContent(a, 0.1, -0.1);
    expect(a.offsetXmm).toBeCloseTo(2.5, 12);
    expect(a.offsetYmm).toBeCloseTo(-2.5, 12);
  });

  it('centerContent on a larger paper', () => {
    const a = centerContent(pdfA4, setPaperSize(initialAdjust(pdfA4), 220, 300, 'top-left'));
    const l = computeLayout(pdfA4, a);
    expect(l.margins.left).toBeCloseTo(5, 12);
    expect(l.margins.top).toBeCloseTo(1.5, 12);
  });

  it('setScale keeps the content center', () => {
    const a = setScale(pdfA4, initialAdjust(pdfA4), 1.002, 1.002);
    const l = computeLayout(pdfA4, a);
    expect(l.content.x + l.content.width / 2).toBeCloseTo(105, 12);
    expect(l.content.width).toBeCloseTo(210.42, 12);
  });
});

describe('DPI helpers', () => {
  it('fitDpiToPaper: the limiting side matches A4 exactly', () => {
    // 1061 × 1482 px image without DPI (the reported case): fits A4 at ~128.3 dpi
    const dpi = fitDpiToPaper(1061, 1482, 210, 297);
    expect(dpi).toBeCloseTo(128.33, 2);
    expect(pxToMm(1061, dpi)).toBeCloseTo(210, 9);
    expect(pxToMm(1482, dpi)).toBeLessThanOrEqual(297);
    // A real 600 dpi A4 scan
    expect(fitDpiToPaper(4961, 7016, 210, 297)).toBeCloseTo(600, 0);
  });

  it('a4For picks the orientation of the image', () => {
    expect(a4For(1061, 1482)).toEqual({ widthMm: 210, heightMm: 297 });
    expect(a4For(1482, 1061)).toEqual({ widthMm: 297, heightMm: 210 });
  });

  it('isImplausibleSheetSize flags DPI mistakes but accepts A4 / B4 / A3 / special sizes', () => {
    expect(isImplausibleSheetSize(44.9, 62.7)).toBe(true); // 1061 × 1482 px at an assumed 600 dpi
    expect(isImplausibleSheetSize(1750, 2474)).toBe(true); // 600 dpi scan read as 72 dpi
    for (const [w, h] of [[210, 297], [216.3, 297], [257, 364], [297, 420], [297, 210]]) {
      expect(isImplausibleSheetSize(w, h)).toBe(false);
    }
  });
});

describe('toPdfPlacement', () => {
  it('converts to PDF user space with y up', () => {
    const a = moveContent(setPaperSize(initialAdjust(pdfA4), 220, 300, 'top-left'), 2, 1);
    const p = toPdfPlacement(computeLayout(pdfA4, a));
    expect(p.pageWidthPt).toBeCloseTo(mmToPt(220), 12);
    expect(p.pageHeightPt).toBeCloseTo(mmToPt(300), 12);
    expect(p.x).toBeCloseTo(mmToPt(2), 12);
    // bottom margin = 300 - 1 - 297 = 2 mm
    expect(p.y).toBeCloseTo(mmToPt(2), 10);
    expect(p.width).toBeCloseTo(mmToPt(210), 12);
  });
});
