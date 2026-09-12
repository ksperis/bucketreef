/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef, type RefObject } from "react";

type DismissibleLayerReason = "escape" | "outside";

type UseDismissibleLayerOptions = {
  open: boolean;
  insideRefs: readonly RefObject<Element | null>[];
  onDismiss: (reason: DismissibleLayerReason) => void;
  dismissOnEscape?: boolean;
  dismissOnFocusOutside?: boolean;
  preventEscapeDefault?: boolean;
  /** Nested popovers consume Escape before their enclosing dialog handles it. */
  stopEscapePropagation?: boolean;
};

export function useDismissibleLayer({
  open,
  insideRefs,
  onDismiss,
  dismissOnEscape = true,
  dismissOnFocusOutside = false,
  preventEscapeDefault = false,
  stopEscapePropagation = false,
}: UseDismissibleLayerOptions) {
  const insideRefsRef = useRef(insideRefs);
  const onDismissRef = useRef(onDismiss);
  insideRefsRef.current = insideRefs;
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const handleOutside = (event: MouseEvent | FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (insideRefsRef.current.some((ref) => ref.current?.contains(target))) {
        return;
      }
      onDismissRef.current("outside");
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (stopEscapePropagation) {
        const target = event.target instanceof Element ? event.target : document.activeElement;
        const dialog = target?.closest('[role="dialog"]');
        // A later confirmation owns Escape while focus is in that dialog.
        if (dialog && !insideRefsRef.current.some(ref => ref.current?.closest('[role="dialog"]') === dialog)) return;
      }
      if (preventEscapeDefault) event.preventDefault();
      if (stopEscapePropagation) event.stopPropagation();
      onDismissRef.current("escape");
    };

    document.addEventListener("mousedown", handleOutside);
    if (dismissOnFocusOutside) document.addEventListener("focusin", handleOutside);
    if (dismissOnEscape) {
      document.addEventListener("keydown", handleKeyDown, stopEscapePropagation);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      if (dismissOnFocusOutside) document.removeEventListener("focusin", handleOutside);
      if (dismissOnEscape) {
        document.removeEventListener("keydown", handleKeyDown, stopEscapePropagation);
      }
    };
  }, [dismissOnEscape, dismissOnFocusOutside, open, preventEscapeDefault, stopEscapePropagation]);
}
