/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useRef, useState } from "react";

type StreamOptions<P> = { signal: AbortSignal; onProgress: (progress: P) => void };

/** One mounted resource owns its stream, cancellation and late-response boundary. */
export function usePortalStreamOperation<P, R>(options: {
  execute: (options: StreamOptions<P>) => Promise<R>;
  onStart?: () => void;
  onResult: (result: R) => void;
  onStopped?: () => void;
  errorMessage: (error: unknown) => string;
  stoppedMessage: string;
  enabled?: boolean;
  autoStart?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<P | null>(null);
  const [result, setResult] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const config = useRef(options);
  config.current = options;
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const started = useRef(false);
  const completed = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  const start = useCallback(async () => {
    const current = config.current;
    if (!mounted.current || current.enabled === false || controller.current || completed.current) return;
    const request = new AbortController();
    controller.current = request;
    started.current = true;
    const ownsRequest = () => mounted.current && controller.current === request;
    setRunning(true);
    setProgress(null);
    setError(null);
    try {
      current.onStart?.();
      const value = await current.execute({ signal: request.signal, onProgress: value => {
        if (ownsRequest() && !request.signal.aborted) setProgress(value);
      } });
      if (!ownsRequest()) return;
      completed.current = true;
      setResult(value);
      current.onResult(value);
    } catch (cause) {
      if (!ownsRequest()) return;
      if (request.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError")) {
        setError(current.stoppedMessage);
        current.onStopped?.();
      } else setError(current.errorMessage(cause));
    } finally {
      if (controller.current === request) {
        controller.current = null;
        if (mounted.current) setRunning(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    // Defer past React's mount/cleanup probe without starting a second mutation.
    if (options.autoStart && options.enabled !== false) void Promise.resolve().then(() => {
      if (active && !started.current) void start();
    });
    return () => { active = false; };
  }, [options.autoStart, options.enabled, start]);

  return { running, progress, result, error, start, stop: () => controller.current?.abort() };
}
