/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
const fingerprints = new WeakMap<File, string>();
export function fingerprintBrowserFile(file: File, signal: AbortSignal, onProgress?: (percent: number) => void): Promise<string> {
  signal.throwIfAborted();
  const cached = fingerprints.get(file);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./browserFingerprint.worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => { signal.removeEventListener("abort", abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException("Upload paused", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ progress?: number; fingerprint?: string; error?: string }>) => {
      if (event.data.progress !== undefined) onProgress?.(event.data.progress);
      if (event.data.fingerprint) { cleanup(); fingerprints.set(file, event.data.fingerprint); resolve(event.data.fingerprint); }
      if (event.data.error) { cleanup(); reject(new Error(event.data.error)); }
    };
    worker.onerror = () => { cleanup(); reject(new Error("Unable to fingerprint this file in a worker.")); };
    worker.postMessage({ file });
  });
}
