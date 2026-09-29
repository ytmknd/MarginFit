import { useState } from 'react';
import {
  addMargin,
  centerContent,
  equalizeHorizontal,
  equalizeVertical,
  setAllMargins,
  setMargin,
  setPaperSize,
  type PaperAnchor,
  type Side,
} from '../lib/geometry';
import type { LoadedFile } from '../lib/loader';
import type { Background } from '../lib/pngUtils';
import { formatLength, fromUnit, toUnit, type LengthUnit } from '../lib/units';
import type { Editor } from '../state/useEditor';
import { formatSmart, NumberField, Section, Segmented } from './common';

const SIDE_LABEL: Record<Side, string> = { top: '上', bottom: '下', left: '左', right: '右' };
const SIDE_ORDER: Side[] = ['top', 'bottom', 'left', 'right'];

interface Props {
  editor: Editor;
  onOpen: () => void;
  onChangeDpi: (dpi: number) => void;
  onChangePage: (pageIndex: number) => void;
  background: Background;
  onBackground: (b: Background) => void;
  notify: (msg: string | null) => void;
}

export function LeftPanel({ editor, onOpen, onChangeDpi, onChangePage, background, onBackground, notify }: Props) {
  const { file } = editor;
  return (
    <aside className="panel panel-left">
      <FileSection file={file} onOpen={onOpen} onChangeDpi={onChangeDpi} onChangePage={onChangePage} />
      {file && editor.adjust && editor.source && (
        <>
          <PaperSection editor={editor} notify={notify} />
          <MarginSection editor={editor} notify={notify} />
          <Section title="余白部分の背景">
            <Segmented<Background>
              value={file.kind === 'pdf' ? 'white' : background}
              onChange={onBackground}
              options={[
                { value: 'white', label: '白' },
                { value: 'transparent', label: '透明', disabled: file.kind === 'pdf' },
              ]}
            />
            <p className="hint">
              {file.kind === 'pdf' ? 'PDFでは背景は白（用紙色）になります。' : '透明はPNG出力のみ有効です（PDFでは白）。'}
            </p>
          </Section>
        </>
      )}
    </aside>
  );
}

function FileSection({
  file,
  onOpen,
  onChangeDpi,
  onChangePage,
}: {
  file: LoadedFile | null;
  onOpen: () => void;
  onChangeDpi: (dpi: number) => void;
  onChangePage: (i: number) => void;
}) {
  return (
    <Section title="ファイル">
      <button type="button" className="primary wide" onClick={onOpen}>
        ファイルを開く（PNG / PDF）
      </button>
      <p className="hint">画面へのドラッグ＆ドロップでも読み込めます。</p>
      {file && (
        <dl className="kv">
          <dt>ファイル名</dt>
          <dd className="filename" title={file.fileName}>
            {file.fileName}
          </dd>
          <dt>形式</dt>
          <dd>{file.kind === 'png' ? `PNG（${pngTypeLabel(file.info.colorType, file.info.bitDepth)}）` : 'PDF'}</dd>
          {file.kind === 'png' && (
            <>
              <dt>DPI</dt>
              <dd>
                <NumberField
                  value={file.dpi}
                  format={(v) => formatSmart(v, 0)}
                  min={1}
                  max={10000}
                  unit="dpi"
                  width={64}
                  onCommit={(v) => onChangeDpi(v)}
                  ariaLabel="DPI"
                />
                <div className={file.fileDpi ? 'hint' : 'hint warn'}>
                  {file.fileDpi
                    ? `ファイルのDPI情報: ${formatSmart(file.fileDpi, 0)} dpi`
                    : 'DPI情報がないため 600 dpi と仮定しています。スキャン時の解像度を指定してください。'}
                </div>
              </dd>
            </>
          )}
          {file.kind === 'pdf' && (
            <>
              <dt>ページ</dt>
              <dd>
                {file.page.pageCount > 1 ? (
                  <select value={file.pageIndex} onChange={(e) => onChangePage(Number(e.target.value))} aria-label="ページ">
                    {Array.from({ length: file.page.pageCount }, (_, i) => (
                      <option key={i} value={i}>
                        {i + 1} / {file.page.pageCount}
                      </option>
                    ))}
                  </select>
                ) : (
                  '1 / 1'
                )}
                {file.page.pageCount > 1 && <div className="hint">選択したページのみを1ページPDFとして出力します。</div>}
              </dd>
              {file.page.rotation !== 0 && (
                <>
                  <dt>回転</dt>
                  <dd>{file.page.rotation}°（表示向きで扱います）</dd>
                </>
              )}
            </>
          )}
        </dl>
      )}
    </Section>
  );
}

function pngTypeLabel(colorType: number, bitDepth: number): string {
  const t = { 0: 'グレー', 2: 'RGB', 3: 'パレット', 4: 'グレー+α', 6: 'RGBA' }[colorType] ?? `type ${colorType}`;
  return `${t} ${bitDepth}bit`;
}

function PaperSection({ editor, notify }: { editor: Editor; notify: (m: string | null) => void }) {
  const [anchor, setAnchor] = useState<PaperAnchor>('center');
  const adj = editor.adjust!;
  const src = editor.source!;
  const applyPaper = (w: number, h: number) =>
    editor.apply((_s, a) => setPaperSize(a, w, h, anchor));

  return (
    <Section title="用紙サイズ">
      <div className="size-now">
        幅 <strong>{formatSmart(adj.paperWidthMm)}</strong> mm × 高さ <strong>{formatSmart(adj.paperHeightMm)}</strong> mm
      </div>
      <div className="row">
        <label>幅</label>
        <NumberField value={adj.paperWidthMm} unit="mm" onCommit={(v) => applyPaper(v, adj.paperHeightMm)} ariaLabel="用紙幅" />
      </div>
      <div className="row">
        <label>高さ</label>
        <NumberField value={adj.paperHeightMm} unit="mm" onCommit={(v) => applyPaper(adj.paperWidthMm, v)} ariaLabel="用紙高さ" />
      </div>
      <div className="row">
        <label>基準</label>
        <Segmented<PaperAnchor>
          value={anchor}
          onChange={setAnchor}
          options={[
            { value: 'center', label: '中央' },
            { value: 'top-left', label: '左上' },
          ]}
        />
      </div>
      <p className="hint">サイズ変更時、増減分を「中央」は両側に均等に、「左上」は右・下側に割り当てます。</p>
      <div className="btn-row">
        <button type="button" onClick={() => notify(applyPaper(210, 297))}>
          A4 縦 210×297
        </button>
        <button type="button" onClick={() => notify(applyPaper(297, 210))}>
          A4 横 297×210
        </button>
      </div>
      <div className="btn-row">
        <button
          type="button"
          title="余白を0にして用紙を下絵と同じ大きさにします"
          onClick={() => notify(editor.apply((s, a) => setAllMargins(s, a, 0)))}
        >
          下絵に合わせる
        </button>
        <button
          type="button"
          title="読み込み時の用紙サイズに戻します（位置は中央基準）"
          onClick={() => notify(applyPaper(src.widthMm, src.heightMm))}
        >
          元のサイズ
        </button>
      </div>
    </Section>
  );
}

function MarginSection({ editor, notify }: { editor: Editor; notify: (m: string | null) => void }) {
  const [unit, setUnit] = useState<LengthUnit>('mm');
  const [amount, setAmount] = useState(1); // always stored in mm
  const [all, setAll] = useState(5);
  const src = editor.source!;
  const layout = editor.layout!;
  const dpi = src.dpi;
  const u = unit === 'mm' ? 'mm' : 'px';
  const fmt = (v: number) => (unit === 'mm' ? formatSmart(v) : formatSmart(v, 0));

  return (
    <Section
      title="余白"
      actions={
        <Segmented<LengthUnit>
          value={unit}
          onChange={setUnit}
          options={[
            { value: 'mm', label: 'mm' },
            { value: 'px', label: 'px' },
          ]}
        />
      }
    >
      {unit === 'px' && <p className="hint">px は {formatSmart(dpi, 0)} dpi 換算です{src.kind === 'pdf' ? '（PDFの参照値）' : ''}。</p>}
      <div className="row">
        <label>増減量</label>
        <NumberField
          value={toUnit(amount, unit, dpi)}
          format={fmt}
          unit={u}
          min={0}
          onCommit={(v) => setAmount(fromUnit(v, unit, dpi))}
          ariaLabel="増減量"
        />
      </div>
      <table className="margin-table">
        <thead>
          <tr>
            <th></th>
            <th>現在の余白</th>
            <th colSpan={2}>増減量を適用</th>
          </tr>
        </thead>
        <tbody>
          {SIDE_ORDER.map((side) => {
            const crop = layout.margins[side] < -1e-9;
            return (
              <tr key={side} className={crop ? 'crop' : undefined}>
                <th>{SIDE_LABEL[side]}</th>
                <td>
                  <NumberField
                    value={toUnit(layout.margins[side], unit, dpi)}
                    format={fmt}
                    unit={u}
                    width={64}
                    title="値を直接入力して余白を指定（負の値は切り取り）"
                    onCommit={(n) => editor.apply((s, a) => setMargin(s, a, side, fromUnit(n, unit, dpi)))}
                    ariaLabel={`${SIDE_LABEL[side]}余白`}
                  />
                  {crop && <div className="crop-note">切り取り</div>}
                </td>
                <td>
                  <button
                    type="button"
                    className="add"
                    title={`${SIDE_LABEL[side]}に ${formatLength(amount, unit, dpi)} ${u} 余白を追加`}
                    onClick={() => notify(editor.apply((_s, a) => addMargin(a, side, amount)))}
                  >
                    ＋追加
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="remove"
                    title={`${SIDE_LABEL[side]}を ${formatLength(amount, unit, dpi)} ${u} 削除（余白がなければ下絵を切り取り）`}
                    onClick={() => notify(editor.apply((_s, a) => addMargin(a, side, -amount)))}
                  >
                    −削除
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">＋追加／−削除で用紙サイズが増減します。余白が負の値になると下絵が切り取られます（赤表示）。</p>

      <h3>揃える（用紙サイズは変えずに下絵を移動）</h3>
      <div className="btn-row">
        <button type="button" onClick={() => notify(editor.apply(equalizeHorizontal))}>
          左右の余白を同じにする
        </button>
        <button type="button" onClick={() => notify(editor.apply(equalizeVertical))}>
          上下の余白を同じにする
        </button>
      </div>
      <button type="button" className="wide" onClick={() => notify(editor.apply(centerContent))}>
        内容を用紙中央に配置
      </button>

      <h3>全方向を同じ余白にする（用紙サイズが変わります）</h3>
      <div className="row">
        <NumberField value={toUnit(all, unit, dpi)} format={fmt} unit={u} onCommit={(v) => setAll(fromUnit(v, unit, dpi))} ariaLabel="全方向の余白" />
        <button type="button" onClick={() => notify(editor.apply((s, a) => setAllMargins(s, a, all)))}>
          全方向に適用
        </button>
      </div>
    </Section>
  );
}
