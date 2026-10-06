/**
 * Prints an in-memory PDF through the browser's own PDF viewer (Chrome / Edge /
 * Firefox), without saving it first. The PDF is loaded into a hidden iframe from
 * a blob URL and the iframe's print dialog is opened. Nothing leaves the browser.
 */

let current: { iframe: HTMLIFrameElement; url: string } | null = null;

function cleanup() {
  if (!current) return;
  current.iframe.remove();
  URL.revokeObjectURL(current.url);
  current = null;
}

/** Time for the PDF viewer inside the iframe to finish rendering before print(). */
const VIEWER_READY_MS = 800;

export function printPdf(bytes: Uint8Array): Promise<void> {
  cleanup();
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const iframe = document.createElement('iframe');
  // Not display:none — some browsers do not load/print hidden PDF frames.
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '1px', height: '1px', border: '0', opacity: '0' });
  iframe.setAttribute('aria-hidden', 'true');
  current = { iframe, url };

  return new Promise((resolve, reject) => {
    iframe.onload = () => {
      setTimeout(() => {
        try {
          const w = iframe.contentWindow;
          if (!w) throw new Error('印刷用のフレームを開けませんでした。');
          w.focus();
          w.print();
          resolve();
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
        // The iframe is kept until the next print (or page unload) because some
        // browsers print asynchronously after print() returns.
      }, VIEWER_READY_MS);
    };
    iframe.onerror = () => reject(new Error('印刷用PDFを読み込めませんでした。'));
    iframe.src = url;
    document.body.appendChild(iframe);
  });
}
