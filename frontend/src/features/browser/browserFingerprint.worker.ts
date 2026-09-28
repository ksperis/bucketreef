/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    const file = event.data.file;
    const hashes: string[] = [];
    const blockSize = 8 * 1024 * 1024;
    for (let offset = 0; offset < file.size; offset += blockSize) {
      const buffer = await file.slice(offset, Math.min(offset + blockSize, file.size)).arrayBuffer();
      hashes.push(hex(await crypto.subtle.digest("SHA-256", buffer)));
      self.postMessage({ progress: Math.min(100, Math.round((offset + buffer.byteLength) / file.size * 100)) });
    }
    // Versioned fingerprint of every block, its size and ordering; no payload retained.
    const fingerprint = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(["blocks-v1", file.size, blockSize, hashes]))));
    self.postMessage({ fingerprint: `blocks-v1:${fingerprint}` });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
export {};
