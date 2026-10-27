/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { MultisiteLogPage } from "../../../api/cephMultisite";

export type LogCursorHistory = {
  current: string | null;
  previous: Array<string | null>;
};

export function advanceLogCursor(history: LogCursorHistory, nextCursor: string): LogCursorHistory {
  return { current: nextCursor, previous: [...history.previous, history.current] };
}

export function retreatLogCursor(history: LogCursorHistory): LogCursorHistory | null {
  if (history.previous.length === 0) return null;
  return {
    current: history.previous[history.previous.length - 1],
    previous: history.previous.slice(0, -1),
  };
}

export function canAdvanceToNextLog(page: MultisiteLogPage | null | undefined): boolean {
  return Boolean(page?.next_log && !page.truncated && !page.next_cursor);
}
