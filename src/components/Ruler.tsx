import { useEffect, useRef } from 'react';

export const RULER_SIZE = 24;

interface RulerProps {
  orientation: 'horizontal' | 'vertical';
  /** Length of the ruler in CSS px. */
  length: number;
  /** Position (CSS px, along the ruler) of the paper's 0 mm edge. */
  origin: number;
  /** CSS px per mm. */
  pxPerMm: number;
  /** Paper extent in mm (highlighted). */
  paperMm: number;
  /** Content extent in mm (marked). */
  contentStart: number;
  contentEnd: number;
}

const LABEL_STEPS = [5, 10, 20, 50, 100, 200, 500];
const MINOR_STEPS = [0.5, 1, 2, 5, 10, 20, 50];

export function Ruler({ orientation, length, origin, pxPerMm, paperMm, contentStart, contentEnd }: RulerProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const horizontal = orientation === 'horizontal';

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || length <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = horizontal ? length : RULER_SIZE;
    const h = horizontal ? RULER_SIZE : length;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // In "ruler space": a = along the ruler, b = across (0 at the outer edge).
    const rect = (a: number, b: number, la: number, lb: number) =>
      horizontal ? ctx.fillRect(a, b, la, lb) : ctx.fillRect(b, a, lb, la);
    const tick = (a: number, len: number) => {
      const x = Math.round(a) + 0.5;
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(x, RULER_SIZE);
        ctx.lineTo(x, RULER_SIZE - len);
      } else {
        ctx.moveTo(RULER_SIZE, x);
        ctx.lineTo(RULER_SIZE - len, x);
      }
      ctx.stroke();
    };

    ctx.fillStyle = '#e4e7eb';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fbfbfc';
    rect(origin, 0, paperMm * pxPerMm, RULER_SIZE);
    ctx.fillStyle = 'rgba(192, 57, 43, 0.35)';
    rect(origin + contentStart * pxPerMm, RULER_SIZE - 4, (contentEnd - contentStart) * pxPerMm, 4);

    const minor = MINOR_STEPS.find((s) => s * pxPerMm >= 5) ?? 100;
    const label = LABEL_STEPS.find((s) => s * pxPerMm >= 45 && s % minor === 0) ?? 1000;
    const mid = label / 2;

    ctx.strokeStyle = '#6b7280';
    ctx.fillStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';

    const startMm = Math.floor(-origin / pxPerMm / minor) * minor;
    const endMm = (length - origin) / pxPerMm;
    for (let i = Math.round(startMm / minor); i * minor <= endMm; i++) {
      const mm = i * minor;
      const a = origin + mm * pxPerMm;
      const isLabel = Math.abs(mm / label - Math.round(mm / label)) < 1e-9;
      const isMid = Math.abs(mm / mid - Math.round(mm / mid)) < 1e-9;
      tick(a, isLabel ? RULER_SIZE - 4 : isMid ? 9 : 5);
      if (isLabel) {
        const text = String(Math.round(mm));
        if (horizontal) {
          ctx.fillText(text, Math.round(a) + 3, 2);
        } else {
          ctx.save();
          ctx.translate(2, Math.round(a) - 3);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(text, 0, 0);
          ctx.restore();
        }
      }
    }
    ctx.strokeStyle = '#9ca3af';
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(0, RULER_SIZE - 0.5);
      ctx.lineTo(w, RULER_SIZE - 0.5);
    } else {
      ctx.moveTo(RULER_SIZE - 0.5, 0);
      ctx.lineTo(RULER_SIZE - 0.5, h);
    }
    ctx.stroke();
  }, [horizontal, length, origin, pxPerMm, paperMm, contentStart, contentEnd]);

  return <canvas ref={ref} className={`ruler ruler-${orientation}`} aria-hidden="true" />;
}
