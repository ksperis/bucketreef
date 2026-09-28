/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { MultipartPartReceipt } from "../../api/browserMultipart";
import { PART_SIZE } from "./browserConstants";
import { fingerprintBrowserFile } from "./browserFileFingerprint";
import { uploadBrowserFileMultipart, type BrowserMultipartUploadLifecycle } from "./browserMultipartUpload";
import { removeLocalUpload, saveLocalUpload, withLocalUploadLock, type LocalUpload } from "./browserTransferStore";
import { normalizeEtag } from "./browserUtils";

export function reconcileUploadParts(local: MultipartPartReceipt[], remote: MultipartPartReceipt[], size: number, partSize: number) {
  const known = new Map(local.map(part => [part.part_number, part]));
  return remote.filter(part => {
    const expected = Math.min(partSize, size - (part.part_number - 1) * partSize);
    const receipt = known.get(part.part_number);
    return Number.isInteger(part.part_number) && part.part_number >= 1 && expected > 0 && receipt &&
      part.size === expected && receipt.size === expected && normalizeEtag(part.etag) === normalizeEtag(receipt.etag);
  });
}

type Options = {
  file: File; controller: AbortController; concurrency: number;
  scope: Pick<LocalUpload, "owner" | "workspace" | "accountId" | "bucket" | "key" | "requiresSse" | "writeGuard">;
  existing?: LocalUpload;
  lifecycle: BrowserMultipartUploadLifecycle;
  listParts: (uploadId: string) => Promise<MultipartPartReceipt[]>;
  onProgress: (percent: number) => void;
  onPreparing: (percent: number) => void;
  onWarning: (message: string) => void;
  onResumable: (id: string | null) => void;
};

export async function verifyBrowserResumeFile(upload: LocalUpload, file: File, signal: AbortSignal) {
  if (file.name !== upload.name || file.size !== upload.size) throw new Error("Select the original file: its name or size does not match.");
  const fingerprint = await fingerprintBrowserFile(file, signal);
  if (fingerprint !== upload.fingerprint) throw new Error("The selected file content does not match the saved fingerprint.");
}

export async function uploadResumableBrowserFile(options: Options): Promise<void> {
  const { file, existing, controller, scope, lifecycle, onWarning } = options;
  if (existing && (existing.owner !== scope.owner || existing.workspace !== scope.workspace || existing.accountId !== scope.accountId || existing.bucket !== scope.bucket || existing.key !== scope.key)) throw new Error("The saved upload belongs to another identity or destination.");
  if (existing?.requiresSse && !scope.requiresSse) throw new Error("Provide the original SSE-C key before resuming this upload.");
  const partSize = existing?.partSize ?? Math.max(PART_SIZE, Math.ceil(file.size / 10000 / (1024 * 1024)) * 1024 * 1024);
  if (!navigator.locks || !scope.owner || typeof Worker === "undefined") {
    if (existing) throw new Error("Local upload recovery is unavailable in this browser.");
    onWarning("Local upload recovery is unavailable in this browser. Interrupted uploads must restart.");
    await uploadBrowserFileMultipart({ file, controller, lifecycle, partSize, concurrency: options.concurrency, onProgress: options.onProgress });
    return;
  }
  const id = existing?.id ?? crypto.randomUUID();
  await withLocalUploadLock(id, async () => {
    if (existing && (file.name !== existing.name || file.size !== existing.size)) throw new Error("Select the original file: its name or size does not match.");
    const fingerprint = await fingerprintBrowserFile(file, controller.signal, options.onPreparing);
    if (existing && fingerprint !== existing.fingerprint) throw new Error("The selected file content does not match the saved fingerprint.");
    const now = Date.now();
    const record: LocalUpload = existing ? { ...existing, writeGuard: scope.writeGuard, parts: [...existing.parts] } : {
      ...scope, id, uploadId: "", name: file.name, size: file.size, lastModified: file.lastModified,
      contentType: file.type, fingerprint, partSize, parts: [], createdAt: now, updatedAt: now, state: "pending",
    };
    let persisted = Boolean(existing);
    let warned = false;
    let writes: Promise<void> = Promise.resolve();
    const persist = () => {
      writes = writes.then(async () => {
        try { await saveLocalUpload(record); persisted = true; }
        catch {
          if (!warned) onWarning("Local storage could not save upload recovery metadata. Keep this tab open; recovery may be incomplete.");
          warned = true;
        }
      });
      return writes;
    };
    try {
      if (existing) {
        const remote = await options.listParts(record.uploadId);
        record.parts = reconcileUploadParts(record.parts, remote, file.size, partSize);
      }
      const resume = {
        uploadId: existing?.uploadId,
        parts: record.parts,
        keepOnError: persisted,
        onInitiated: async (uploadId: string) => {
          record.uploadId = uploadId;
          await persist();
          resume.keepOnError = persisted;
          options.onResumable(persisted ? id : null);
        },
        onPart: async (part: MultipartPartReceipt) => {
          record.parts = [...record.parts.filter(receipt => receipt.part_number !== part.part_number), part];
          await persist();
        },
      };
      await uploadBrowserFileMultipart({ file, controller, partSize, concurrency: options.concurrency, onProgress: options.onProgress, resume,
        lifecycle: { ...lifecycle, abort: async uploadId => {
          await lifecycle.abort(uploadId);
          if (persisted) await removeLocalUpload(id);
        } },
      });
      if (persisted) await removeLocalUpload(id).catch(() => onWarning("The upload completed, but its local recovery entry could not be removed."));
    } catch (error) {
      const status = (error as { response?: { status?: number }; status?: number })?.response?.status ?? (error as { status?: number })?.status;
      if (status === 404 && existing) { record.state = "unavailable"; await persist(); }
      throw error;
    } finally { await writes; }
  });
}
