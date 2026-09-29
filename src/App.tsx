import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { formatSmart } from './components/common';
import { ExportDialog } from './components/ExportDialog';
import { LeftPanel } from './components/LeftPanel';
import { MOVE_STEP_MM, MOVE_STEP_SHIFT_MM, RightPanel } from './components/RightPanel';
import { Viewer, type GuideOptions } from './components/Viewer';
import { downloadBytes } from './lib/download';
import {
  a4For,
  centerContent,
  fitDpiToPaper,
  isImplausibleSheetSize,
  moveContent,
  setPaperSize,
  type Adjust,
  type SourceGeometry,
} from './lib/geometry';
import { loadFile, loadPdf, LOW_DPI_WARNING, releaseFile, sourceGeometry, type LoadedFile } from './lib/loader';
import { createCalibrationPdf } from './lib/pdfUtils';
import type { Background } from './lib/pngUtils';
import { useEditor } from './state/useEditor';

const PRIVACY = 'All processing is performed locally in your browser.';

export default function App() {
  const editor = useEditor();
  const [background, setBackground] = useState<Background>('white');
  const [guides, setGuides] = useState<GuideOptions>({ centerV: true, centerH: true, margins: true, content: true, paper: true });
  const [calibration, setCalibration] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: 'error' | 'info' } | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<LoadedFile | null>(null);

  const notify = useCallback((text: string | null) => {
    if (text) setMessage({ text, kind: 'error' });
  }, []);

  const replaceFile = (f: LoadedFile, prepare?: (src: SourceGeometry, adj: Adjust) => Adjust) => {
    // A DPI change reuses the same decoded image; only release truly replaced files.
    if (fileRef.current && fileRef.current.previewUrl !== f.previewUrl) releaseFile(fileRef.current);
    fileRef.current = f;
    editor.load(f, prepare);
    if (f.kind === 'pdf') setBackground('white');
  };

  const confirmDiscard = () => !editor.isModified || window.confirm('現在の調整内容は破棄されます。よろしいですか？');

  const openFile = async (file: File) => {
    if (!confirmDiscard()) return;
    setLoading(true);
    setMessage(null);
    try {
      const f = await loadFile(file);
      replaceFile(f);
      const g = sourceGeometry(f);
      if (isImplausibleSheetSize(g.widthMm, g.heightMm)) {
        setMessage({
          text: `実寸が ${formatSmart(g.widthMm)} × ${formatSmart(g.heightMm)} mm になっています。DPIが正しいか確認してください。`,
          kind: 'error',
        });
      } else {
        setMessage({ text: `${f.fileName} を読み込みました。`, kind: 'info' });
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), kind: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const changeDpi = (dpi: number) => {
    const f = editor.file;
    if (!f || f.kind !== 'png' || dpi === f.dpi) return;
    if (!confirmDiscard()) return;
    // Same image, different physical size: restart editing from the new size.
    replaceFile({ ...f, dpi });
    setMessage({ text: `DPIを ${formatSmart(dpi, 0)} に変更しました（調整はリセットされました）。`, kind: 'info' });
  };

  /** Sets the DPI so the image fits A4 (same orientation), then puts it centered on an exact A4 sheet. */
  const fitDpiToA4 = () => {
    const f = editor.file;
    if (!f || f.kind !== 'png') return;
    if (!confirmDiscard()) return;
    const a4 = a4For(f.info.width, f.info.height);
    const dpi = fitDpiToPaper(f.info.width, f.info.height, a4.widthMm, a4.heightMm);
    replaceFile({ ...f, dpi }, (src, adj) => centerContent(src, setPaperSize(adj, a4.widthMm, a4.heightMm, 'top-left')));
    setMessage({
      text: `A4に合わせて ${formatSmart(dpi, 1)} dpi に設定しました（Undoで取り消し可）。`,
      kind: dpi < LOW_DPI_WARNING ? 'error' : 'info',
    });
  };

  const changePage = async (pageIndex: number) => {
    const f = editor.file;
    if (!f || f.kind !== 'pdf' || pageIndex === f.pageIndex) return;
    if (!confirmDiscard()) return;
    setLoading(true);
    try {
      replaceFile(await loadPdf(f.fileName, f.bytes, pageIndex));
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), kind: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const calibrationPdf = async () => {
    const w = editor.adjust?.paperWidthMm ?? 210;
    const h = editor.adjust?.paperHeightMm ?? 297;
    try {
      const bytes = await createCalibrationPdf(w, h);
      downloadBytes(bytes, `marginfit_calibration_${formatSmart(w)}x${formatSmart(h)}mm.pdf`, 'application/pdf');
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), kind: 'error' });
    }
  };

  // Keyboard: arrows move the artwork, Ctrl+Z / Ctrl+Y undo / redo.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.closest('input, select, textarea, dialog') || t.isContentEditable)) return;
      const ed = editorRef.current;
      if (!ed.adjust) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        ed.undo();
        return;
      }
      if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        ed.redo();
        return;
      }
      if (ctrl || e.altKey) return;
      const step = e.shiftKey ? MOVE_STEP_SHIFT_MM : MOVE_STEP_MM;
      const d: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const v = d[e.key];
      if (!v) return;
      e.preventDefault();
      const err = ed.apply((_s, a) => moveContent(a, v[0], v[1]));
      if (err) setMessage({ text: err, kind: 'error' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Drag & drop anywhere in the window.
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) void openFile(f);
  };

  const hasDoc = !!(editor.file && editor.layout);

  return (
    <div
      className={`app${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="3" y="3" width="26" height="26" rx="3" fill="#fff" fillOpacity="0.15" stroke="#fff" />
            <rect x="9" y="9" width="14" height="14" fill="#fff" />
          </svg>
          <span className="logo">MarginFit</span>
          <span className="tagline">印刷用下絵の用紙サイズ・余白調整</span>
        </div>
        <div className="topbar-actions">
          <button type="button" disabled={!editor.canUndo} onClick={editor.undo} title="元に戻す (Ctrl+Z)">
            ↶ Undo
          </button>
          <button type="button" disabled={!editor.canRedo} onClick={editor.redo} title="やり直す (Ctrl+Y)">
            ↷ Redo
          </button>
          <button
            type="button"
            disabled={!editor.isModified}
            onClick={editor.reset}
            title="読み込み直後の状態に戻す（Undoで取り消せます）"
          >
            Reset
          </button>
          <button type="button" className="export" disabled={!hasDoc} onClick={() => setShowExport(true)}>
            Export…
          </button>
        </div>
      </header>

      <input
        ref={inputRef}
        type="file"
        accept=".png,.pdf,image/png,application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void openFile(f);
        }}
      />

      <main className="workspace">
        <LeftPanel
          editor={editor}
          onOpen={() => inputRef.current?.click()}
          onChangeDpi={changeDpi}
          onFitDpiToA4={fitDpiToA4}
          onChangePage={(i) => void changePage(i)}
          background={background}
          onBackground={setBackground}
          notify={notify}
        />
        <div className="center">
          {hasDoc ? (
            <Viewer
              file={editor.file!}
              layout={editor.layout!}
              background={editor.file!.kind === 'pdf' ? 'white' : background}
              guides={guides}
              calibration={calibration}
              toolbar={(zoom) => (
                <>
                  {zoom}
                  <span className="sep" />
                  <span className="guides">
                    ガイド:
                    {(
                      [
                        ['centerV', '中央線(縦)'],
                        ['centerH', '中央線(横)'],
                        ['margins', '余白'],
                        ['content', '下絵境界'],
                        ['paper', '用紙境界'],
                      ] as [keyof GuideOptions, string][]
                    ).map(([key, label]) => (
                      <label key={key} className="check">
                        <input
                          type="checkbox"
                          checked={guides[key]}
                          onChange={(e) => setGuides({ ...guides, [key]: e.target.checked })}
                        />
                        {label}
                      </label>
                    ))}
                  </span>
                  <span className="sep" />
                  <label className="check">
                    <input type="checkbox" checked={calibration} onChange={(e) => setCalibration(e.target.checked)} />
                    Calibration Mode
                  </label>
                  <button type="button" onClick={() => void calibrationPdf()} title="100mm線と10mm方眼のPDFを現在の用紙サイズで生成">
                    Calibration PDF
                  </button>
                </>
              )}
            />
          ) : (
            <button type="button" className="dropzone" onClick={() => inputRef.current?.click()}>
              <span className="dz-title">PNG または PDF をここにドラッグ＆ドロップ</span>
              <span>またはクリックしてファイルを選択</span>
              <span className="dz-note">600 dpi 程度でスキャンした賞状などの下絵を想定しています。</span>
              <span className="dz-privacy">{PRIVACY}</span>
            </button>
          )}
          {loading && <div className="loading">読み込み中…</div>}
        </div>
        <RightPanel editor={editor} notify={notify} />
      </main>

      <footer className="statusbar">
        <span className="privacy">🔒 {PRIVACY}（ファイルは外部に送信されません）</span>
        {message && (
          <span className={`msg ${message.kind}`}>
            {message.text}
            <button type="button" className="link" onClick={() => setMessage(null)} aria-label="閉じる">
              ×
            </button>
          </span>
        )}
        {!hasDoc && (
          <button type="button" className="link" onClick={() => void calibrationPdf()}>
            Calibration PDF（A4）を生成
          </button>
        )}
      </footer>

      {showExport && hasDoc && <ExportDialog editor={editor} background={background} onClose={() => setShowExport(false)} />}
      {dragOver && <div className="drop-overlay">ここにドロップして読み込み</div>}
    </div>
  );
}
