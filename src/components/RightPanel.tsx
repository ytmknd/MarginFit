import { useState, type MouseEvent } from 'react';
import { correctPrintOffset, moveContent, setScale, type Layout, type SourceGeometry } from '../lib/geometry';
import type { LoadedFile } from '../lib/loader';
import { mmToPt, mmToPx, pxToMm, roundTo } from '../lib/units';
import type { Editor } from '../state/useEditor';
import { formatSmart, NumberField, Section } from './common';

export const MOVE_STEP_MM = 0.1;
export const MOVE_STEP_SHIFT_MM = 1;

interface Props {
  editor: Editor;
  notify: (msg: string | null) => void;
}

export function RightPanel({ editor, notify }: Props) {
  if (!editor.file || !editor.adjust || !editor.layout || !editor.source) {
    return <aside className="panel panel-right" />;
  }
  return (
    <aside className="panel panel-right">
      <MoveSection editor={editor} notify={notify} />
      <PrintOffsetSection editor={editor} notify={notify} />
      <ScaleSection editor={editor} notify={notify} />
      <InfoSection file={editor.file} source={editor.source} layout={editor.layout} />
    </aside>
  );
}

function MoveSection({ editor, notify }: Props) {
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const adj = editor.adjust!;
  const move = (mx: number, my: number) => notify(editor.apply((_s, a) => moveContent(a, mx, my)));
  const step = (e: MouseEvent) => (e.shiftKey ? MOVE_STEP_SHIFT_MM : MOVE_STEP_MM);

  return (
    <Section title="下絵の位置・移動">
      <div className="arrow-pad" role="group" aria-label="下絵を移動">
        <span />
        <button type="button" title="上へ（Shift: 1mm）" onClick={(e) => move(0, -step(e))}>
          ↑
        </button>
        <span />
        <button type="button" title="左へ（Shift: 1mm）" onClick={(e) => move(-step(e), 0)}>
          ←
        </button>
        <span className="pad-center">0.1</span>
        <button type="button" title="右へ（Shift: 1mm）" onClick={(e) => move(step(e), 0)}>
          →
        </button>
        <span />
        <button type="button" title="下へ（Shift: 1mm）" onClick={(e) => move(0, step(e))}>
          ↓
        </button>
        <span />
      </div>
      <p className="hint">クリック: 0.1 mm ／ Shift＋クリック: 1 mm。キーボードの矢印キー（Shiftで1 mm）でも移動できます。</p>

      <h3>移動量を指定</h3>
      <div className="row">
        <label>右へ</label>
        <NumberField value={dx} unit="mm" onCommit={setDx} ariaLabel="右方向の移動量" />
      </div>
      <div className="row">
        <label>下へ</label>
        <NumberField value={dy} unit="mm" onCommit={setDy} ariaLabel="下方向の移動量" />
      </div>
      <p className="hint">負の値で左／上へ移動します。</p>
      <button type="button" className="wide" disabled={dx === 0 && dy === 0} onClick={() => move(dx, dy)}>
        指定量だけ移動
      </button>

      <dl className="kv compact">
        <dt>用紙左上からの位置</dt>
        <dd>
          X {formatSmart(adj.offsetXmm, 2)} ／ Y {formatSmart(adj.offsetYmm, 2)} mm
        </dd>
        <dt>累計移動量</dt>
        <dd>
          右 {formatSmart(adj.moveXmm, 2)} ／ 下 {formatSmart(adj.moveYmm, 2)} mm
        </dd>
      </dl>
    </Section>
  );
}

/**
 * Enter the offset exactly as seen on the test print ("printed 1.2 mm to the
 * right"); the artwork is moved the opposite way. Avoids sign mistakes.
 */
function PrintOffsetSection({ editor, notify }: Props) {
  const [hDir, setHDir] = useState<1 | -1>(1); // 1 = right, -1 = left
  const [vDir, setVDir] = useState<1 | -1>(1); // 1 = down, -1 = up
  const [h, setH] = useState(0);
  const [v, setV] = useState(0);
  const printedRight = hDir * h;
  const printedDown = vDir * v;
  const none = h === 0 && v === 0;

  const describe = () => {
    const parts: string[] = [];
    if (h) parts.push(`${printedRight > 0 ? '左' : '右'}へ ${formatSmart(h, 2)} mm`);
    if (v) parts.push(`${printedDown > 0 ? '上' : '下'}へ ${formatSmart(v, 2)} mm`);
    return parts.join('、');
  };

  return (
    <Section title="印刷のずれを補正">
      <p className="hint">
        試し刷り（Export… →「位置合わせ用の試し刷りPDF」）を実物と重ね、印刷された下絵が本物の印刷からどちらへ何 mm ずれていたかを、見たまま入力してください。
      </p>
      <div className="row">
        <span className="offset-label">印刷が</span>
        <select value={hDir} onChange={(e) => setHDir(Number(e.target.value) as 1 | -1)} aria-label="左右のずれの向き">
          <option value={1}>右へ</option>
          <option value={-1}>左へ</option>
        </select>
        <NumberField value={h} unit="mm" min={0} max={50} width={56} onCommit={setH} ariaLabel="左右のずれ量" />
      </div>
      <div className="row">
        <span className="offset-label">印刷が</span>
        <select value={vDir} onChange={(e) => setVDir(Number(e.target.value) as 1 | -1)} aria-label="上下のずれの向き">
          <option value={1}>下へ</option>
          <option value={-1}>上へ</option>
        </select>
        <NumberField value={v} unit="mm" min={0} max={50} width={56} onCommit={setV} ariaLabel="上下のずれ量" />
      </div>
      <button
        type="button"
        className="wide"
        disabled={none}
        onClick={() => {
          const err = editor.apply((_s, a) => correctPrintOffset(a, printedRight, printedDown));
          notify(err);
          if (!err) {
            setH(0);
            setV(0);
          }
        }}
      >
        ずれを打ち消す
      </button>
      <p className="hint">{none ? 'ずれていた量を入力すると、下絵を逆方向へ移動します。' : `下絵を ${describe()} 移動します。`}</p>
      <p className="hint">補正は印刷したプリンター・給紙トレイ固有のずれも含みます。本番も同じプリンターで印刷してください。</p>
    </Section>
  );
}

const fmtPct = (v: number) => (v * 100).toFixed(3);

function ScaleSection({ editor, notify }: Props) {
  const [lock, setLock] = useState(true);
  const adj = editor.adjust!;
  const src = editor.source!;
  // Round away float noise so e.g. 100% + 0.1% - 0.1% is exactly 1 again (1:1 pixels).
  const apply = (sx: number, sy: number) => editor.apply((s, a) => setScale(s, a, roundTo(sx, 9), roundTo(sy, 9)));

  return (
    <Section title="下絵の拡大縮小">
      <p className="hint">余白の変更とは別の機能です。通常は 100% のまま使用してください。</p>
      {lock ? (
        <div className="row">
          <label>倍率</label>
          <NumberField
            value={adj.scaleX}
            format={fmtPct}
            unit="%"
            min={1}
            max={1000}
            onCommit={(v) => apply(v / 100, v / 100)}
            ariaLabel="倍率"
          />
        </div>
      ) : (
        <>
          <div className="row">
            <label>横</label>
            <NumberField value={adj.scaleX} format={fmtPct} unit="%" min={1} max={1000} onCommit={(v) => apply(v / 100, adj.scaleY)} ariaLabel="横倍率" />
          </div>
          <div className="row">
            <label>縦</label>
            <NumberField value={adj.scaleY} format={fmtPct} unit="%" min={1} max={1000} onCommit={(v) => apply(adj.scaleX, v / 100)} ariaLabel="縦倍率" />
          </div>
        </>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={lock}
          onChange={(e) => {
            setLock(e.target.checked);
            if (e.target.checked && adj.scaleX !== adj.scaleY) notify(apply(adj.scaleX, adj.scaleX));
          }}
        />
        縦横比を固定
      </label>
      <div className="btn-row">
        <button type="button" onClick={() => notify(apply(adj.scaleX - 0.001, lock ? adj.scaleY - 0.001 : adj.scaleY))}>
          −0.1%
        </button>
        <button type="button" onClick={() => notify(apply(adj.scaleX + 0.001, lock ? adj.scaleY + 0.001 : adj.scaleY))}>
          ＋0.1%
        </button>
        <button type="button" disabled={adj.scaleX === 1 && adj.scaleY === 1} onClick={() => notify(apply(1, 1))}>
          100%に戻す
        </button>
      </div>
      {src.kind === 'png' && (adj.scaleX !== 1 || adj.scaleY !== 1) && (
        <p className="hint warn">拡大縮小中はPNGの画素が再サンプリングされます（100%なら元の画素をそのまま保持）。</p>
      )}
    </Section>
  );
}

export interface SizeRow {
  label: string;
  value: string;
}

/** Original / adjusted size rows, shared by the info panel and the export preview. */
export function sizeRows(file: LoadedFile, source: SourceGeometry, layout: Layout | null): SizeRow[] {
  const rows: SizeRow[] = [];
  if (!layout) {
    rows.push({ label: 'Width × Height', value: `${formatSmart(source.widthMm, 2)} × ${formatSmart(source.heightMm, 2)} mm` });
    if (file.kind === 'png') {
      rows.push({ label: 'Pixels', value: `${file.info.width} × ${file.info.height} px` });
      rows.push({ label: 'DPI', value: `${formatSmart(file.dpi, 0)} dpi${file.fileDpi ? '' : '（指定値）'}` });
    } else {
      rows.push({ label: 'Points', value: `${formatSmart(file.page.widthPt, 2)} × ${formatSmart(file.page.heightPt, 2)} pt` });
      rows.push({
        label: 'Pixels',
        value: `${Math.round(mmToPx(source.widthMm, source.dpi))} × ${Math.round(mmToPx(source.heightMm, source.dpi))} px（${source.dpi} dpi換算）`,
      });
      rows.push({ label: 'DPI', value: 'ベクター（解像度なし）' });
    }
    return rows;
  }

  rows.push({ label: 'Width × Height', value: `${formatSmart(layout.paperWidthMm, 2)} × ${formatSmart(layout.paperHeightMm, 2)} mm` });
  if (file.kind === 'png' && layout.raster) {
    const r = layout.raster;
    rows.push({ label: 'Pixels', value: `${r.canvasWidth} × ${r.canvasHeight} px` });
    rows.push({ label: 'DPI', value: `${formatSmart(r.dpi, 0)} dpi` });
    rows.push({
      label: 'PNG実寸',
      value: `${formatSmart(pxToMm(r.canvasWidth, r.dpi), 3)} × ${formatSmart(pxToMm(r.canvasHeight, r.dpi), 3)} mm`,
    });
    rows.push({
      label: 'PDF用紙',
      value: `${formatSmart(mmToPt(layout.paperWidthMm), 2)} × ${formatSmart(mmToPt(layout.paperHeightMm), 2)} pt`,
    });
  } else {
    rows.push({
      label: 'Points',
      value: `${formatSmart(mmToPt(layout.paperWidthMm), 2)} × ${formatSmart(mmToPt(layout.paperHeightMm), 2)} pt`,
    });
    rows.push({
      label: 'Pixels',
      value: `${Math.round(mmToPx(layout.paperWidthMm, source.dpi))} × ${Math.round(mmToPx(layout.paperHeightMm, source.dpi))} px（${source.dpi} dpi換算）`,
    });
    rows.push({ label: 'DPI', value: 'ベクター（再ラスタライズなし）' });
  }
  return rows;
}

function InfoSection({ file, source, layout }: { file: LoadedFile; source: SourceGeometry; layout: Layout }) {
  return (
    <Section title="サイズ情報">
      <h3>Original</h3>
      <table className="info-table">
        <tbody>
          {sizeRows(file, source, null).map((r) => (
            <tr key={r.label}>
              <th>{r.label}</th>
              <td>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Adjusted</h3>
      <table className="info-table adjusted">
        <tbody>
          {sizeRows(file, source, layout).map((r) => (
            <tr key={r.label}>
              <th>{r.label}</th>
              <td>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {file.kind === 'png' && (
        <p className="hint">
          PNGは整数ピクセルのため、実寸は指定値と最大 ±{formatSmart(pxToMm(0.5, source.dpi), 3)} mm 異なる場合があります。PDF出力は指定値どおりの用紙サイズになります。
        </p>
      )}
    </Section>
  );
}
