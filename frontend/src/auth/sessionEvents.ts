/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export const SESSION_ENDED_EVENT = "bucketreef:session-ended";
export const SESSION_ENDED_STORAGE_KEY = "bucketreef:session-ended-at";

export function broadcastSessionEnded(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SESSION_ENDED_STORAGE_KEY,
      `${Date.now()}:${Math.random()}`,
    );
  } catch {
    // The same-tab event still clears local state when storage is unavailable.
  }
  window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
}

export function isSessionEndedStorageEvent(event: StorageEvent): boolean {
  return event.key === SESSION_ENDED_STORAGE_KEY && event.newValue !== null;
}
