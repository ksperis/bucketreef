/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ManagerPrivateAccessState } from "../../api/managerContext";

export function personalAccessDisabledReason(state: ManagerPrivateAccessState | null): string | null {
  switch (state) {
    case "provisioning":
      return "Personal access is being created.";
    case "active":
      return "Personal access already created.";
    case "deleting":
      return "Personal access is being deleted.";
    case "cleanup_pending":
      return "Personal access cleanup is required.";
    default:
      return null;
  }
}
