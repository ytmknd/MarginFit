/// <reference lib="webworker" />
/**
 * Runs the lossless PNG re-encode off the main thread, so a 600 dpi A4 scan
 * (~35 megapixels) does not freeze the UI while it is filtered and compressed.
 */
import type { Layout } from './geometry';
import { exportPngLossless, type Background, type PngInfo } from './pngUtils';

export interface PngWorkerRequest {
  info: PngInfo;
  layout: Layout;
  background: Background;
}

export type PngWorkerResponse = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

self.onmessage = async (e: MessageEvent<PngWorkerRequest>) => {
  const { info, layout, background } = e.data;
  try {
    const bytes = await exportPngLossless(info, layout, background);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ ok: true, bytes } satisfies PngWorkerResponse, [bytes.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies PngWorkerResponse);
  }
};
