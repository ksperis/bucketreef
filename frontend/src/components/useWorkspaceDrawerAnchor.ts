/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useLayoutEffect, useRef } from "react";

// Fixed drawers need a viewport coordinate, including any toolbar above Layout.
export function useWorkspaceDrawerAnchor() {
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    let frame = 0;
    const update = () => {
      content.style.setProperty("--workspace-content-top", `${content.getBoundingClientRect().top}px`);
    };
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    observer?.observe(content);
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, []);
  return contentRef;
}
