import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Layout } from '../lib/geometry';
import type { LoadedFile } from '../lib/loader';
import type { Background } from '../lib/pngUtils';
import { MM_PER_INCH } from '../lib/units';
import { formatSmart } from './common';
import { Ruler, RULER_SIZE } from './Ruler';

/** CSS reference: at zoom 100 %, 1 inch = 96 CSS px (actual screen size depends on the monitor). */
const CSS_PX_PER_MM = 96 / MM_PER_INCH;
const PAD = 48;
const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2];
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;

export interface GuideOptions {
  centerV: boolean;
  centerH: boolean;
  margins: boolean;
  content: boolean;
  paper: boolean;
}

interface ViewerProps {
  file: LoadedFile;
  layout: Layout;
  background: Background;
  guides: GuideOptions;
  calibration: boolean;
  toolbar: (zoomControls: ReactNode) => ReactNode;
}

export function Viewer({ file, layout, background, guides, calibration, toolbar }: ViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  /** Pending "keep this mm point under the cursor" after a zoom change. */
  const anchor = useRef<{ mmX: number; mmY: number; vx: number; vy: number } | null>(null);

  const k = zoom * CSS_PX_PER_MM;
  const W = layout.paperWidthMm;
  const H = layout.paperHeightMm;
  const c = layout.content;

  // Stage geometry (CSS px). Include content that sticks out of the paper.
  const minX = Math.min(0, c.x);
  const minY = Math.min(0, c.y);
  const maxX = Math.max(W, c.x + c.width);
  const maxY = Math.max(H, c.y + c.height);
  const stageW = (maxX - minX) * k + 2 * PAD;
  const stageH = (maxY - minY) * k + 2 * PAD;
  const outerW = Math.max(stageW, size.w);
  const outerH = Math.max(stageH, size.h);
  const ox = (outerW - stageW) / 2 + PAD - minX * k; // paper origin within the scroll area
  const oy = (outerH - stageH) / 2 + PAD - minY * k;

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const z = Math.min((el.clientWidth - 2 * PAD) / (W * CSS_PX_PER_MM), (el.clientHeight - 2 * PAD) / (H * CSS_PX_PER_MM));
    anchor.current = null;
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)));
  }, [W, H]);

  // Fit to screen whenever a new file is loaded.
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useLayoutEffect(() => {
    fitRef.current();
  }, [file]);

  const zoomTo = useCallback(
    (z: number, vx?: number, vy?: number) => {
      const el = viewportRef.current;
      if (!el) return;
      const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
      const px = vx ?? el.clientWidth / 2;
      const py = vy ?? el.clientHeight / 2;
      anchor.current = { mmX: (el.scrollLeft + px - ox) / k, mmY: (el.scrollTop + py - oy) / k, vx: px, vy: py };
      setZoom(nz);
    },
    [ox, oy, k],
  );

  // After a zoom change, restore the anchored point under the cursor / center.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = ox + a.mmX * k - a.vx;
    el.scrollTop = oy + a.mmY * k - a.vy;
    setScroll({ x: el.scrollLeft, y: el.scrollTop });
  }, [zoom, ox, oy, k]);

  // Ctrl + wheel zoom (needs a non-passive listener to prevent browser zoom).
  const zoomToRef = useRef(zoomTo);
  zoomToRef.current = zoomTo;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomToRef.current(zoomRef.current * factor, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomPercent = Math.round(zoom * 1000) / 10;
  const zoomControls = (
    <span className="zoom">
      <button type="button" onClick={() => zoomTo(zoom / 1.25)} title="縮小">
        −
      </button>
      <select
        value={ZOOM_PRESETS.includes(zoom) ? String(zoom) : 'custom'}
        onChange={(e) => (e.target.value === 'fit' ? fit() : zoomTo(Number(e.target.value)))}
        aria-label="表示倍率"
      >
        {!ZOOM_PRESETS.includes(zoom) && <option value="custom">{zoomPercent}%</option>}
        {ZOOM_PRESETS.map((z) => (
          <option key={z} value={String(z)}>
            {z * 100}%
          </option>
        ))}
        <option value="fit">画面に合わせる</option>
      </select>
      <button type="button" onClick={() => zoomTo(zoom * 1.25)} title="拡大">
        ＋
      </button>
      <button type="button" onClick={fit}>
        画面に合わせる
      </button>
    </span>
  );

  const px = (mm: number) => mm * k;
  const m = layout.margins;
  const checker = background === 'transparent';

  return (
    <div className="viewer">
      <div className="viewer-toolbar">{toolbar(zoomControls)}</div>
      <div className="viewer-grid">
        <div className="ruler-corner" title="単位: mm" style={{ width: RULER_SIZE, height: RULER_SIZE }}>
          mm
        </div>
        <Ruler
          orientation="horizontal"
          length={size.w}
          origin={ox - scroll.x}
          pxPerMm={k}
          paperMm={W}
          contentStart={c.x}
          contentEnd={c.x + c.width}
        />
        <Ruler
          orientation="vertical"
          length={size.h}
          origin={oy - scroll.y}
          pxPerMm={k}
          paperMm={H}
          contentStart={c.y}
          contentEnd={c.y + c.height}
        />
        <div
          className="viewport"
          ref={viewportRef}
          onScroll={(e) => setScroll({ x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop })}
        >
          <div className="stage" style={{ width: outerW, height: outerH }}>
            {/* Parts of the artwork outside the paper (will be cropped) */}
            <img
              className="content-ghost"
              src={file.previewUrl}
              alt=""
              draggable={false}
              style={{ left: ox + px(c.x), top: oy + px(c.y), width: px(c.width), height: px(c.height) }}
            />
            <div
              className={`paper${checker ? ' checker' : ''}`}
              style={{ left: ox, top: oy, width: px(W), height: px(H) }}
            >
              <img
                className="content"
                src={file.previewUrl}
                alt="下絵"
                draggable={false}
                style={{ left: px(c.x), top: px(c.y), width: px(c.width), height: px(c.height) }}
              />
            </div>
            <svg className="overlay" width={outerW} height={outerH} aria-hidden="true">
              <g transform={`translate(${ox} ${oy})`}>
                {calibration && <CalibrationOverlay W={W} H={H} k={k} />}
                {guides.margins && <MarginGuides layout={layout} k={k} />}
                {guides.centerV && (
                  <line className="g-center" x1={px(W / 2)} y1={-12} x2={px(W / 2)} y2={px(H) + 12} />
                )}
                {guides.centerH && (
                  <line className="g-center" x1={-12} y1={px(H / 2)} x2={px(W) + 12} y2={px(H / 2)} />
                )}
                {guides.content && (
                  <rect className="g-content" x={px(c.x)} y={px(c.y)} width={px(c.width)} height={px(c.height)} />
                )}
                {guides.paper && <rect className="g-paper" x={0} y={0} width={px(W)} height={px(H)} />}
              </g>
            </svg>
          </div>
        </div>
      </div>
      <div className="viewer-status">
        用紙 {formatSmart(W)} × {formatSmart(H)} mm ／ 余白 上 {formatSmart(m.top)}・下 {formatSmart(m.bottom)}・左{' '}
        {formatSmart(m.left)}・右 {formatSmart(m.right)} mm ／ 表示 {zoomPercent}%
        <span className="muted">（画面上の表示サイズはモニターにより実寸と異なります）</span>
      </div>
    </div>
  );
}

function MarginGuides({ layout, k }: { layout: Layout; k: number }) {
  const W = layout.paperWidthMm;
  const H = layout.paperHeightMm;
  const c = layout.content;
  const m = layout.margins;
  const px = (v: number) => v * k;
  // Content rectangle clipped to the paper (vertical extent of the side margin bands)
  const y0 = Math.max(0, c.y);
  const x1 = Math.min(W, c.x + c.width);
  const y1 = Math.min(H, c.y + c.height);

  const label = (text: string, x: number, y: number, crop: boolean) => (
    <text className={crop ? 'g-label crop' : 'g-label'} x={x} y={y} textAnchor="middle" dominantBaseline="middle">
      {text}
    </text>
  );
  const txt = (v: number) => (v < 0 ? `切取 ${formatSmart(-v)} mm` : `${formatSmart(v)} mm`);

  return (
    <g>
      {m.top > 0 && <rect className="g-margin" x={0} y={0} width={px(W)} height={px(m.top)} />}
      {m.bottom > 0 && <rect className="g-margin" x={0} y={px(y1)} width={px(W)} height={px(m.bottom)} />}
      {m.left > 0 && <rect className="g-margin" x={0} y={px(y0)} width={px(m.left)} height={px(y1 - y0)} />}
      {m.right > 0 && <rect className="g-margin" x={px(x1)} y={px(y0)} width={px(m.right)} height={px(y1 - y0)} />}
      {label(txt(m.top), px(W / 2), 10, m.top < 0)}
      {label(txt(m.bottom), px(W / 2), px(H) - 10, m.bottom < 0)}
      <g transform={`translate(12 ${px(H / 2)}) rotate(-90)`}>{label(txt(m.left), 0, 0, m.left < 0)}</g>
      <g transform={`translate(${px(W) - 12} ${px(H / 2)}) rotate(90)`}>{label(txt(m.right), 0, 0, m.right < 0)}</g>
    </g>
  );
}

function CalibrationOverlay({ W, H, k }: { W: number; H: number; k: number }) {
  const px = (v: number) => v * k;
  const lines: ReactNode[] = [];
  for (let x = 10; x < W; x += 10) lines.push(<line key={`x${x}`} className="cal-grid" x1={px(x)} y1={0} x2={px(x)} y2={px(H)} />);
  for (let y = 10; y < H; y += 10) lines.push(<line key={`y${y}`} className="cal-grid" x1={0} y1={px(y)} x2={px(W)} y2={px(y)} />);

  const ticks: ReactNode[] = [];
  const ox = 20;
  const oy = 20;
  const fitsH = ox + 100 <= W && oy <= H;
  const fitsV = oy + 100 <= H && ox <= W;
  for (let i = 0; i <= 100; i += 1) {
    const len = i % 10 === 0 ? 4 : i % 5 === 0 ? 2.5 : 1.2;
    if (k * 1 < 2.5 && i % 5 !== 0) continue; // too dense at low zoom
    if (fitsH) ticks.push(<line key={`h${i}`} className="cal-tick" x1={px(ox + i)} y1={px(oy)} x2={px(ox + i)} y2={px(oy - len)} />);
    if (fitsV) ticks.push(<line key={`v${i}`} className="cal-tick" x1={px(ox)} y1={px(oy + i)} x2={px(ox - len)} y2={px(oy + i)} />);
  }
  return (
    <g>
      {lines}
      {fitsH && <line className="cal-line" x1={px(ox)} y1={px(oy)} x2={px(ox + 100)} y2={px(oy)} />}
      {fitsV && <line className="cal-line" x1={px(ox)} y1={px(oy)} x2={px(ox)} y2={px(oy + 100)} />}
      {ticks}
      {fitsH && (
        <text className="cal-label" x={px(ox + 50)} y={px(oy) + 14} textAnchor="middle">
          100 mm
        </text>
      )}
      {fitsV && (
        <text className="cal-label" transform={`translate(${px(ox) + 14} ${px(oy + 50)}) rotate(90)`} textAnchor="middle">
          100 mm
        </text>
      )}
    </g>
  );
}
