/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { MultipartPartReceipt } from "../../api/browserMultipart";
import type { BrowserWorkspaceSurface } from "../../api/browserWorkspace";
import type { BrowserWriteGuard } from "../../api/browserConflicts";

export type LocalUpload = {
  id: string; owner: string; workspace: BrowserWorkspaceSurface; accountId: string; bucket: string; key: string;
  uploadId: string; name: string; size: number; lastModified: number; contentType: string;
  fingerprint: string; partSize: number; parts: MultipartPartReceipt[]; requiresSse: boolean;
  createdAt: number; updatedAt: number; state: "pending" | "unavailable"; writeGuard?: BrowserWriteGuard;
};
export type LocalTransferBatch = {
  id: string; owner: string; workspace: BrowserWorkspaceSurface; accountId: string; bucket: string; prefix: string;
  label: string; completedAt: number; succeeded: number; failed: number; cancelled: number;
};

const DB_NAME = "bucketreef-browser-transfers-v1";
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Local transfer storage is unavailable.")); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("uploads", { keyPath: "id" });
      request.result.createObjectStore("history", { keyPath: "id" });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Local transfer storage is blocked by another tab."));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}

async function transaction<T>(store: "uploads" | "history", mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = run(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); if (mode === "readwrite") window.dispatchEvent(new Event("browser-transfers-changed")); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || request.error || new Error("Local transfer storage failed.")); };
  });
}

export async function saveLocalUpload(upload: LocalUpload): Promise<void> {
  // Explicit allowlist: never serialize a File, credentials, URLs, SSE keys or callbacks.
  const { id, owner, workspace, accountId, bucket, key, uploadId, name, size, lastModified, contentType, fingerprint, partSize, requiresSse, createdAt, state } = upload;
  await transaction("uploads", "readwrite", store => store.put({ id, owner, workspace, accountId, bucket, key, uploadId, name, size, lastModified, contentType, fingerprint, partSize, requiresSse, createdAt, state,
    updatedAt: Date.now(), parts: upload.parts.map(({ part_number, etag, size }) => ({ part_number, etag, size })),
    writeGuard: upload.writeGuard ? { exists: upload.writeGuard.exists, etag: upload.writeGuard.etag } : undefined,
  } satisfies LocalUpload));
}
export async function listLocalUploads(owner: string, workspace: BrowserWorkspaceSurface): Promise<LocalUpload[]> {
  const rows = await transaction<LocalUpload[]>("uploads", "readonly", store => store.getAll());
  return rows.filter(row => row.owner === owner && row.workspace === workspace).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function removeLocalUpload(id: string) { await transaction("uploads", "readwrite", store => store.delete(id)); }

export async function saveTransferBatch(batch: LocalTransferBatch) {
  const { id, owner, workspace, accountId, bucket, prefix, label, completedAt, succeeded, failed, cancelled } = batch;
  await transaction("history", "readwrite", store => store.put({ id, owner, workspace, accountId, bucket, prefix, label, completedAt, succeeded, failed, cancelled }));
  await listTransferHistory(owner, workspace);
}
export async function listTransferHistory(owner: string, workspace: BrowserWorkspaceSurface): Promise<LocalTransferBatch[]> {
  const all = await transaction<LocalTransferBatch[]>("history", "readonly", store => store.getAll());
  const scoped = all.filter(row => row.owner === owner && row.workspace === workspace).sort((a, b) => b.completedAt - a.completedAt);
  const keep = scoped.filter(row => row.completedAt >= Date.now() - 30 * 86400000).slice(0, 20);
  const ids = new Set(keep.map(row => row.id));
  for (const row of scoped) if (!ids.has(row.id)) await transaction("history", "readwrite", store => store.delete(row.id));
  return keep;
}

export async function withLocalUploadLock<T>(id: string, run: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error("This browser cannot lock resumable uploads across tabs.");
  return navigator.locks.request(`bucketreef-upload:${id}`, { mode: "exclusive", ifAvailable: true }, lock => {
    if (!lock) throw new Error("This upload is already active in another tab.");
    return run();
  });
}
