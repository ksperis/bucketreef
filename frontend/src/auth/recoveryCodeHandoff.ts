/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
// This state must never be persisted, broadcast to other tabs, or included in diagnostics.
type HandoffState = { phase: "idle" | "pending"; codes: readonly string[] } | { phase: "ready"; codes: readonly string[] };
const idle: HandoffState = { phase: "idle", codes: [] };
let state: HandoffState = idle;
let owner: symbol | null = null;
let authRedirectDeferred = false;
const listeners = new Set<() => void>();
function publish(next: HandoffState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function deferRecoveryAuthRedirect(): boolean {
  if (state.phase === "idle") return false;
  authRedirectDeferred = true;
  return true;
}

export const recoveryCodeHandoff = {
  getSnapshot: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  begin() {
    if (state.phase !== "idle") throw new Error("Recovery code handoff already in progress");
    const operation = Symbol();
    owner = operation;
    publish({ phase: "pending", codes: [] });
    return {
      complete(codes: string[]) {
        if (owner !== operation) return;
        if (codes.length === 0) throw new Error("No recovery codes returned");
        publish({ phase: "ready", codes: [...codes] });
      },
      cancel() {
        if (owner !== operation) return;
        const redirect = authRedirectDeferred;
        recoveryCodeHandoff.reset();
        if (redirect) window.location.replace("/login");
      },
    };
  },
  reset() {
    owner = null;
    authRedirectDeferred = false;
    publish(idle);
  },
};
