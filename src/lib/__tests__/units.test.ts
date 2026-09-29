import { describe, expect, it } from 'vitest';
import {
  dpiToPpm,
  dpiToPpmExact,
  mmToPt,
  mmToPx,
  parseNumber,
  ppmToDpi,
  ppmToNominalDpi,
  ptToMm,
  pxToMm,
  roundTo,
} from '../units';

const SIZES_MM = [0.1, 1, 3, 25.4, 100, 210, 216.3, 297, 297.1, 420, 1234.5678];

describe('mm ⇄ pt', () => {
  it('uses 72 pt per 25.4 mm exactly', () => {
    expect(mmToPt(25.4)).toBe(72);
    expect(ptToMm(72)).toBe(25.4);
  });

  it('A4 is 595.2756 × 841.8898 pt', () => {
    expect(mmToPt(210)).toBeCloseTo(595.275590551, 9);
    expect(mmToPt(297)).toBeCloseTo(841.88976378, 8);
  });

  it.each(SIZES_MM)('mm → pt → mm round-trips %f mm with error < 1e-12 mm', (mm) => {
    expect(Math.abs(ptToMm(mmToPt(mm)) - mm)).toBeLessThan(1e-12);
  });
});

describe.each([300, 600])('mm ⇄ px at %i dpi', (dpi) => {
  it('one inch is exactly dpi pixels', () => {
    expect(mmToPx(25.4, dpi)).toBe(dpi);
    expect(pxToMm(dpi, dpi)).toBe(25.4);
  });

  it.each(SIZES_MM)('mm → px → mm round-trips %f mm with error < 1e-12 mm', (mm) => {
    expect(Math.abs(pxToMm(mmToPx(mm, dpi), dpi) - mm)).toBeLessThan(1e-12);
  });

  it('rounding to whole pixels loses at most half a pixel', () => {
    const halfPixelMm = 25.4 / dpi / 2;
    for (const mm of SIZES_MM) {
      const px = Math.round(mmToPx(mm, dpi));
      expect(Math.abs(pxToMm(px, dpi) - mm)).toBeLessThanOrEqual(halfPixelMm + 1e-12);
    }
  });

  it('A4 pixel sizes', () => {
    const w = Math.round(mmToPx(210, dpi));
    const h = Math.round(mmToPx(297, dpi));
    expect([w, h]).toEqual(dpi === 300 ? [2480, 3508] : [4961, 7016]);
  });

  it('0.1 mm steps accumulate without meaningful drift', () => {
    let mm = 0;
    for (let i = 0; i < 1000; i++) mm += 0.1;
    // 1000 × 0.1 mm = 100 mm; float drift must be far below one pixel
    expect(Math.abs(mmToPx(mm, dpi) - mmToPx(100, dpi))).toBeLessThan(1e-9);
  });
});

describe('DPI ⇄ pixels per metre (PNG pHYs)', () => {
  it('600 dpi = 23622 ppm, 300 dpi = 11811 ppm, 72 dpi = 2835 ppm, 96 dpi = 3780 ppm', () => {
    expect(dpiToPpm(600)).toBe(23622);
    expect(dpiToPpm(300)).toBe(11811);
    expect(dpiToPpm(72)).toBe(2835);
    expect(dpiToPpm(96)).toBe(3780);
    expect(dpiToPpmExact(600)).toBeCloseTo(23622.0472, 4);
  });

  it('reads stored ppm back as the nominal DPI', () => {
    for (const dpi of [72, 96, 150, 200, 300, 400, 600, 1200]) {
      expect(ppmToNominalDpi(dpiToPpm(dpi))).toBe(dpi);
    }
    expect(ppmToDpi(23622)).toBeCloseTo(599.9988, 4);
  });

  it('keeps non-standard ppm values exact', () => {
    expect(ppmToNominalDpi(10000)).toBeCloseTo(254, 10);
    expect(ppmToNominalDpi(12345)).toBeCloseTo(313.563, 3);
  });
});

describe('helpers', () => {
  it('roundTo', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(216.34999, 1)).toBe(216.3);
    expect(roundTo(-2.25, 1)).toBe(-2.3);
  });

  it('parseNumber accepts full-width and comma input', () => {
    expect(parseNumber('３．５')).toBe(3.5);
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('-2')).toBe(-2);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
});
