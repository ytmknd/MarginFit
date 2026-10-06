import { useEffect, useRef, useState } from 'react';
import { downloadBytes, outputName } from '../lib/download';
import { ALIGN_MARK_INSET_MM, createAlignmentPdf, exportPdfFromPdf, exportPdfFromPng, type PdfArtwork } from '../lib/pdfUtils';
import { exportPng, type Background } from '../lib/pngUtils';
import { printPdf } from '../lib/print';
import { mmToPx } from '../lib/units';
import type { Editor } from '../state/useEditor';
import { formatSmart } from './common';
import { sizeRows } from './RightPanel';

interface Props {
  editor: Editor;
  background: Background;
  onClose: () => void;
}

type Busy = null | 'png' | 'pdf' | 'align' | 'print';

export function ExportDialog({ editor, background, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const file = editor.file!;
  const src = editor.source!;
  const adj = editor.adjust!;
  const layout = editor.layout!;
  const m = layout.margins;
  const im = editor.initial!;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const [alignOpacity, setAlignOpacity] = useState(0.3);

  /** Creates the alignment test print and either saves it or sends it to the printer. */
  const runAlignment = async (action: 'save' | 'print') => {
    setBusy(action === 'save' ? 'align' : 'print');
    setError(null);
    setDone(null);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const art: PdfArtwork =
        file.kind === 'png'
          ? { kind: 'png', bytes: file.bytes, info: file.info }
          : { kind: 'pdf', bytes: file.bytes, pageIndex: file.pageIndex };
      const bytes = await createAlignmentPdf(art, layout, alignOpacity);
      if (action === 'save') {
        downloadBytes(bytes, outputName(file.fileName, 'pdf', '_試し刷り'), 'application/pdf');
        setDone('試し刷りPDFを保存しました。「実際のサイズ」で印刷し、実物と重ねてずれを測ってください。');
      } else {
        await printPdf(bytes);
        setDone('印刷画面を開きました。倍率が「実際のサイズ（100%）」になっていることを確認して印刷してください。');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const run = async (kind: 'png' | 'pdf') => {
    setBusy(kind);
    setError(null);
    setDone(null);
    // Let the "processing" state render before the heavy synchronous work.
    await new Promise((r) => setTimeout(r, 30));
    try {
      let bytes: Uint8Array;
      let note = '';
      if (kind === 'png') {
        if (file.kind !== 'png') throw new Error('PNG出力はPNG入力時のみ利用できます。');
        const res = await exportPng(file.bytes, file.info, layout, background);
        bytes = res.bytes;
        note = res.method === 'lossless' ? '元の画素をそのままコピー（ロスレス）' : 'Canvas経由で描画';
        downloadBytes(bytes, outputName(file.fileName, 'png'), 'image/png');
      } else if (file.kind === 'png') {
        bytes = await exportPdfFromPng(file.bytes, file.info, layout);
        downloadBytes(bytes, outputName(file.fileName, 'pdf'), 'application/pdf');
      } else {
        bytes = await exportPdfFromPdf(file.bytes, file.pageIndex, layout);
        downloadBytes(bytes, outputName(file.fileName, 'pdf'), 'application/pdf');
      }
      setDone(`${kind.toUpperCase()} を保存しました（${(bytes.length / 1024 / 1024).toFixed(2)} MB${note ? `、${note}` : ''}）。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const marginText = (v: number) => (v < -1e-9 ? `切り取り ${formatSmart(-v, 2)} mm` : `${formatSmart(v, 2)} mm`);
  const scaled = adj.scaleX !== 1 || adj.scaleY !== 1;
  const warnings: string[] = [];
  if (Object.values(m).some((v) => v < -1e-9)) warnings.push('下絵の一部が用紙の外にあり、出力では切り取られます。');
  if (scaled && file.kind === 'png') warnings.push('拡大縮小しているため、PNGの画素は再サンプリングされます。');
  if (file.kind === 'png' && !file.fileDpi) warnings.push(`元PNGにDPI情報がないため ${formatSmart(file.dpi, 0)} dpi として実寸を計算しています。`);
  if (background === 'transparent' && file.kind === 'png') warnings.push('透明背景はPNG出力のみ有効です（PDFでは白）。');

  const r = layout.raster;
  const pngPaperNote =
    r && (Math.abs(mmToPx(layout.paperWidthMm, r.dpi) - r.canvasWidth) > 1e-6 || Math.abs(mmToPx(layout.paperHeightMm, r.dpi) - r.canvasHeight) > 1e-6);

  return (
    <dialog ref={ref} className="export-dialog" onClose={onClose} onCancel={(e) => busy && e.preventDefault()}>
      <h2>出力プレビュー</h2>
      <div className="export-grid">
        <div>
          <h3>最終出力</h3>
          <table className="info-table">
            <tbody>
              {sizeRows(file, src, layout).map((row) => (
                <tr key={row.label}>
                  <th>{row.label}</th>
                  <td>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pngPaperNote && (
            <p className="hint">PNGは整数ピクセルに丸めるため、実寸がPDFの用紙サイズとわずかに異なります。</p>
          )}
        </div>
        <div>
          <h3>調整内容</h3>
          <table className="info-table">
            <tbody>
              <tr>
                <th>用紙サイズ変更</th>
                <td>
                  {formatSmart(im.paperWidthMm, 2)} × {formatSmart(im.paperHeightMm, 2)} → {formatSmart(adj.paperWidthMm, 2)} ×{' '}
                  {formatSmart(adj.paperHeightMm, 2)} mm
                </td>
              </tr>
              <tr>
                <th>余白 上</th>
                <td>{marginText(m.top)}</td>
              </tr>
              <tr>
                <th>余白 下</th>
                <td>{marginText(m.bottom)}</td>
              </tr>
              <tr>
                <th>余白 左</th>
                <td>{marginText(m.left)}</td>
              </tr>
              <tr>
                <th>余白 右</th>
                <td>{marginText(m.right)}</td>
              </tr>
              <tr>
                <th>下絵の移動量</th>
                <td>
                  右 {formatSmart(adj.moveXmm, 2)} mm ／ 下 {formatSmart(adj.moveYmm, 2)} mm
                </td>
              </tr>
              <tr>
                <th>拡大率</th>
                <td>
                  {adj.scaleX === adj.scaleY
                    ? `${(adj.scaleX * 100).toFixed(3)} %`
                    : `横 ${(adj.scaleX * 100).toFixed(3)} % ／ 縦 ${(adj.scaleY * 100).toFixed(3)} %`}
                </td>
              </tr>
              {r && (
                <tr>
                  <th>下絵の配置</th>
                  <td>
                    ({r.dx}, {r.dy}) px に {r.dw} × {r.dh} px
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <p className="hint">印刷・AwardPrintでは「実際のサイズ／100%」で扱ってください。ガイド線は出力に含まれません。</p>

      <div className="align-box">
        <h3>位置合わせ用の試し刷り</h3>
        <p className="hint">
          下絵を薄く印刷し、中心の十字と、用紙の各辺からちょうど {ALIGN_MARK_INSET_MM} mm の位置に基準マーク（マゼンタ）を入れたPDFです。
          賞状用紙に印刷して本物の枠との二重線を見比べるか、普通紙に印刷して重ねて透かしてください。
          紙の端から基準マークまでが {ALIGN_MARK_INSET_MM}.0 mm でなければ、その差はプリンター自体のずれです。
          測ったずれは右側の「印刷のずれを補正」に入力します。
        </p>
        <div className="row">
          <span className="offset-label">濃さ</span>
          <select value={alignOpacity} onChange={(e) => setAlignOpacity(Number(e.target.value))} aria-label="試し刷りの下絵の濃さ">
            <option value={0.2}>20%</option>
            <option value={0.3}>30%</option>
            <option value={0.5}>50%</option>
            <option value={1}>100%</option>
          </select>
          <button type="button" disabled={!!busy} onClick={() => void runAlignment('print')}>
            {busy === 'print' ? '準備中…' : 'プリンターで印刷'}
          </button>
          <button type="button" disabled={!!busy} onClick={() => void runAlignment('save')}>
            {busy === 'align' ? '作成中…' : 'PDFを保存'}
          </button>
        </div>
        <p className="hint">
          「プリンターで印刷」はブラウザの印刷画面を開きます。<strong>倍率（拡大縮小）は「実際のサイズ」</strong>、余白は「なし」または「デフォルト」を選び、「用紙に合わせる」は選ばないでください。
        </p>
      </div>

      {error && <p className="error">エラー: {error}</p>}
      {done && <p className="success">{done}</p>}

      <div className="dialog-actions">
        {file.kind === 'png' && (
          <button type="button" className="primary" disabled={!!busy} onClick={() => run('png')}>
            {busy === 'png' ? 'PNGを書き出し中…' : 'PNGとして保存'}
          </button>
        )}
        <button type="button" className="primary" disabled={!!busy} onClick={() => run('pdf')}>
          {busy === 'pdf' ? 'PDFを書き出し中…' : 'PDFとして保存'}
        </button>
        <button type="button" disabled={!!busy} onClick={() => ref.current?.close()}>
          閉じる
        </button>
      </div>
    </dialog>
  );
}
