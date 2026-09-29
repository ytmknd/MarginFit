/**
 * Unit conversion. All physical quantities are kept as float64 internally;
 * rounding happens only for display or where an integer is physically required
 * (pixel dimensions, PNG pHYs values).
 *
 *   1 inch = 25.4 mm   (exact, by definition)
 *   1 inch = 72 pt     (PDF user space unit)
 *   1 inch = dpi px
 *   1 m    = 1000 mm → pixels per metre = dpi / 0.0254
 */

export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;
export const MM_PER_METER = 1000;

export function mmToPt(mm: number): number {
  return (mm * PT_PER_INCH) / MM_PER_INCH;
}

export function ptToMm(pt: number): number {
  return (pt * MM_PER_INCH) / PT_PER_INCH;
}

export function mmToPx(mm: number, dpi: number): number {
  return (mm * dpi) / MM_PER_INCH;
}

export function pxToMm(px: number, dpi: number): number {
  return (px * MM_PER_INCH) / dpi;
}

export function mmToInch(mm: number): number {
  return mm / MM_PER_INCH;
}

export function inchToMm(inch: number): number {
  return inch * MM_PER_INCH;
}

/** DPI → pixels per metre (float). 600 dpi = 23622.047… ppm. */
export function dpiToPpmExact(dpi: number): number {
  return (dpi * MM_PER_METER) / MM_PER_INCH;
}

/** DPI → pixels per metre as stored in a PNG pHYs chunk (unsigned 32-bit integer). */
export function dpiToPpm(dpi: number): number {
  return Math.round(dpiToPpmExact(dpi));
}

/** Pixels per metre → DPI (float). 23622 ppm = 599.9988 dpi. */
export function ppmToDpi(ppm: number): number {
  return (ppm * MM_PER_INCH) / MM_PER_METER;
}

/**
 * pHYs stores an integer ppm, so a nominal 600 dpi reads back as 599.9988 dpi.
 * If a round-tripped value is within the quantisation error of an integer ppm
 * (±0.5 ppm ≈ ±0.0127 dpi) of a whole-number DPI, return the whole number.
 */
export function ppmToNominalDpi(ppm: number): number {
  const exact = ppmToDpi(ppm);
  const nearest = Math.round(exact);
  if (nearest > 0 && dpiToPpm(nearest) === ppm) return nearest;
  return exact;
}

/** Round to a fixed number of decimals without the 1.005 → 1.00 binary artefact. */
export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  // Round half away from zero, so -2.25 and 2.25 behave symmetrically.
  return (Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * f)) / f;
}

export function formatMm(mm: number, decimals = 1): string {
  const v = roundTo(mm, decimals);
  return (Object.is(v, -0) ? 0 : v).toFixed(decimals);
}

export type LengthUnit = 'mm' | 'px';

export function toUnit(mm: number, unit: LengthUnit, dpi: number): number {
  return unit === 'mm' ? mm : mmToPx(mm, dpi);
}

export function fromUnit(value: number, unit: LengthUnit, dpi: number): number {
  return unit === 'mm' ? value : pxToMm(value, dpi);
}

export function formatLength(mm: number, unit: LengthUnit, dpi: number, mmDecimals = 1): string {
  if (unit === 'mm') return formatMm(mm, mmDecimals);
  return formatMm(mmToPx(mm, dpi), 0);
}

/** Parses user input, accepting full-width digits and a comma decimal separator. */
export function parseNumber(text: string): number | null {
  const normalized = text
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[－ー−]/g, '-')
    .replace(/[＋]/g, '+')
    .replace(',', '.');
  if (normalized === '' || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
