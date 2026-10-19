/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import {
  isAllowedTransferUrl,
  type DirectTransferRequest,
  type DirectTransferCommand,
  type DirectTransferResponse,
} from "./browserDirectTransferProtocol";

// HTTP worker responses carry the authoritative CSP. Messages cannot widen it.
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<{ request: DirectTransferRequest; sources: string[] }>) => void) | null;
  postMessage: (message: unknown) => void;
};

workerScope.onmessage = event => {
  const port = event.ports[0];
  if (!port) return;
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let pulling = false;
  let closed = false;
  const send = (message: DirectTransferResponse, transfer: Transferable[] = []) => {
    if (!closed) port.postMessage(message, transfer);
  };
  const close = () => { closed = true; port.close(); };
  const fail = (error: unknown) => {
    send({ type: "error", name: error instanceof Error ? error.name : "Error", message: "Direct S3 transfer failed. Check endpoint reachability, TLS, CORS and the transfer policy." });
    controller.abort();
    void reader?.cancel().catch(() => undefined);
    close();
  };
  port.onmessage = async ({ data }: MessageEvent<DirectTransferCommand>) => {
    if (data.type === "cancel") {
      controller.abort();
      await reader?.cancel().catch(() => undefined);
      close();
    } else if (data.type === "pull" && reader && !pulling && !closed) {
      pulling = true;
      try {
        const { value, done } = await reader.read();
        if (done) { send({ type: "end" }); close(); }
        else {
          const bytes = new Uint8Array(value).buffer;
          send({ type: "chunk", bytes }, [bytes]);
        }
      } catch (error) { fail(error); }
      finally { pulling = false; }
    }
  };
  port.onmessageerror = fail;
  const { request, sources } = event.data;
  void (async () => {
    if (!isAllowedTransferUrl(request.url, sources) || !["GET", "PUT"].includes(request.method)) {
      throw new Error("Destination is outside the transfer context");
    }
    const response = await fetch(request.url, {
      method: request.method, headers: request.headers, body: request.body,
      credentials: "omit", signal: controller.signal,
    });
    // Successful PUT callers need headers only; do not keep an unread body alive.
    if (request.method === "PUT" && response.ok) await response.body?.cancel();
    else reader = response.body?.getReader();
    send({ type: "headers", status: response.status, statusText: response.statusText,
      headers: [...response.headers.entries()], hasBody: Boolean(reader) });
    if (!reader) { send({ type: "end" }); close(); }
  })().catch(fail);
};
workerScope.postMessage({ type: "ready" });
