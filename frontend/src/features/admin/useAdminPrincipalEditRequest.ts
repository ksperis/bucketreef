/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useRef } from "react";

import {
  type AdminPrincipalEditRequest,
  readAdminPrincipalEditRequest,
} from "./adminPrincipalEditLink";

export function useAdminPrincipalEditRequest(): AdminPrincipalEditRequest | null {
  return useMemo(
    () => readAdminPrincipalEditRequest(typeof window === "undefined" ? "" : window.location.search),
    [],
  );
}

export function useOpenRequestedAdminPrincipal<T extends { id: number }>(
  request: AdminPrincipalEditRequest | null,
  items: readonly T[],
  openItem: (item: T) => void,
): void {
  const handledRef = useRef(false);
  const openItemRef = useRef(openItem);
  openItemRef.current = openItem;

  useEffect(() => {
    if (!request || handledRef.current) return;
    const requestedItem = items.find((item) => item.id === request.id);
    if (!requestedItem) return;
    handledRef.current = true;
    openItemRef.current(requestedItem);
  }, [items, request]);
}
