/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef } from "react";
import type { BrowserWorkspaceSurface } from "../../api/browserWorkspace";
import { saveTransferBatch } from "./browserTransferStore";
import type { OperationItem, UploadQueueItem } from "./browserTypes";

export function useBrowserTransferHistory(owner: string, workspace: BrowserWorkspaceSurface, operations: OperationItem[], queued: UploadQueueItem[], onWarning: (message: string) => void) {
  const saved = useRef(new Map<string, string>());
  useEffect(() => {
    if (!owner) return;
    const groups = new Map<string, OperationItem[]>();
    for (const op of operations) {
      if (!op.destination || op.kind === "activity") continue;
      const key = op.groupId ?? op.id;
      groups.set(key, [...(groups.get(key) ?? []), op]);
    }
    for (const [id, items] of groups) {
      if (items.some(op => !op.completedAt || op.completionStatus === "paused") || queued.some(item => item.groupId === id)) continue;
      const signature = items.map(op => `${op.id}:${op.completionStatus}:${JSON.stringify(op.resultCounts)}`).sort().join("|");
      const storageId = `${owner}:${workspace}:${id}`;
      if (saved.current.get(storageId) === signature) continue;
      saved.current.set(storageId, signature);
      const first = items[0];
      void saveTransferBatch({ id: storageId, owner, workspace, ...first.destination!, label: first.groupLabel ?? first.label,
        completedAt: Math.max(...items.map(op => op.completedTimestamp ?? Date.now())),
        succeeded: items.reduce((sum, op) => sum + (op.resultCounts?.succeeded ?? Number(op.completionStatus === "done")), 0),
        failed: items.reduce((sum, op) => sum + (op.resultCounts?.failed ?? Number(op.completionStatus === "failed")), 0),
        cancelled: items.reduce((sum, op) => sum + (op.resultCounts?.cancelled ?? Number(op.completionStatus === "cancelled")), 0),
      }).catch(() => onWarning("Local transfer history could not be saved. Browser storage may be unavailable or full."));
    }
  }, [owner, workspace, operations, queued, onWarning]);
}
