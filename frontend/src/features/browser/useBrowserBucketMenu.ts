/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useDismissibleLayer } from "../../components/ui/useDismissibleLayer";

export function useBrowserBucketMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
  }, []);
  const toggle = useCallback(() => {
    setOpen((current) => !current);
  }, []);

  useDismissibleLayer({
    open,
    insideRefs: [rootRef],
    onDismiss: close,
  });

  useEffect(() => {
    if (open) filterInputRef.current?.focus();
  }, [open]);

  return {
    close,
    filterInputRef,
    open,
    rootRef,
    toggle,
  };
}
