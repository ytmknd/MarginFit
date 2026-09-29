/** Triggers a browser download of in-memory data (no network involved). */
export function downloadBytes(bytes: Uint8Array, fileName: string, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function outputName(sourceName: string, ext: 'png' | 'pdf', suffix = '_marginfit'): string {
  const base = sourceName.replace(/\.[^.]+$/, '') || 'output';
  return `${base}${suffix}.${ext}`;
}
