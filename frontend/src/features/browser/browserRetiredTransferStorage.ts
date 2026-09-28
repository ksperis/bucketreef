/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
let requested = false;

/** Retire local receipts only; orphaned S3 uploads remain under user control. */
export function retireBrowserTransferStorage(): void {
  if (requested || typeof indexedDB === "undefined") return;
  try {
    const request = indexedDB.deleteDatabase("bucketreef-browser-transfers-v1");
    requested = true;
    request.onerror = () => { requested = false; };
    // A prior tab may still hold the database. Deletion waits without blocking UI.
  } catch {
    // Disabled browser storage must not prevent ordinary transfers.
  }
}
