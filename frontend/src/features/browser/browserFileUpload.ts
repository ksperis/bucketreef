/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { UploadProgressEvent } from "../../api/browserTransfers";
import { defaultBrowserText, type BrowserTextFn } from "./browserI18n";

type PresignedFileUpload = {
  url: string;
  method: string;
  headers?: Record<string, string>;
};

type UploadBrowserFileParams = {
  text?: BrowserTextFn;
  file: File;
  mode: "direct" | "proxy";
  signal?: AbortSignal;
  onProgress: (event: UploadProgressEvent) => void;
  uploadProxy: () => Promise<void>;
  presign: () => Promise<PresignedFileUpload>;
};

export const uploadBrowserFile = async ({
  file,
  mode,
  signal,
  onProgress,
  uploadProxy,
  presign,
  text = defaultBrowserText,
}: UploadBrowserFileParams): Promise<void> => {
  if (mode === "proxy") {
    await uploadProxy();
    return;
  }

  const signedUpload = await presign();
  const method = signedUpload.method.toUpperCase();
  if (method !== "PUT") {
    throw new Error(text("Unexpected presigned upload method: {method}.", { method }));
  }

  onProgress({ loaded: 0, total: file.size, progress: 0 });
  const response = await fetch(signedUpload.url, {
    method: "PUT",
    headers: {
      ...(signedUpload.headers || {}),
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
    credentials: "omit",
    signal,
  });
  if (!response.ok) throw new Error(text("Direct upload failed with status {status}", { status: response.status }));
  onProgress({ loaded: file.size, total: file.size, progress: 1 });
};
