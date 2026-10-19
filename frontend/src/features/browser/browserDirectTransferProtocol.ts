/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
export type DirectTransferRequest = {
  url: string;
  method: "GET" | "PUT";
  headers: [string, string][];
  body?: Blob;
};

export type DirectTransferResponse =
  | { type: "headers"; status: number; statusText: string; headers: [string, string][]; hasBody: boolean }
  | { type: "chunk"; bytes: ArrayBuffer }
  | { type: "end" }
  | { type: "error"; name: string; message: string };

export type DirectTransferCommand = { type: "pull" } | { type: "cancel" };

export function isAllowedTransferUrl(url: string, sources: string[]): boolean {
  let target: URL;
  try { target = new URL(url); } catch { return false; }
  if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) return false;
  return sources.some(source => {
    const wildcard = source.includes("://*.");
    const origin = new URL(source.replace("://*.", "://"));
    return target.protocol === origin.protocol && target.port === origin.port && (
      wildcard
        ? target.hostname.endsWith(`.${origin.hostname}`)
        : target.hostname === origin.hostname
    );
  });
}
