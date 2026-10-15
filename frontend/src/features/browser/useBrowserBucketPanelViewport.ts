/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useEffect, useLayoutEffect, useRef } from "react";

const BUCKET_ACCESS_ROOT_MARGIN = "120px";
const BUCKET_LOAD_MORE_ROOT_MARGIN = "160px";

type BucketPanelRow = {
  bucket: {
    name: string;
  };
};

type UseBrowserBucketPanelViewportOptions = {
  activeBucketName: string;
  canLoadMore: boolean;
  enabled: boolean;
  onLoadMore: () => void;
  rows: readonly BucketPanelRow[];
  scheduleAccessProbe: (bucketName: string) => void;
};

export function useBrowserBucketPanelViewport({
  activeBucketName,
  canLoadMore,
  enabled,
  onLoadMore,
  rows,
  scheduleAccessProbe,
}: UseBrowserBucketPanelViewportOptions) {
  const panelViewportRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!enabled) return;
    const scroller = panelViewportRef.current;
    if (!scroller) return;
    if (typeof scroller.scrollTo === "function") {
      scroller.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    scroller.scrollTop = 0;
  }, [activeBucketName, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const root = panelViewportRef.current;
    if (!root) return;
    const rowNodes = Array.from(
      root.querySelectorAll<HTMLElement>("[data-bucket-panel-name]"),
    );
    if (rowNodes.length === 0) return;

    const rootRect = root.getBoundingClientRect();
    const rootMarginPx = Number.parseInt(BUCKET_ACCESS_ROOT_MARGIN, 10) || 0;
    const viewportTop = rootRect.top - rootMarginPx;
    const viewportBottom = rootRect.bottom + rootMarginPx;
    rowNodes.forEach((node) => {
      const bucketName = node.dataset.bucketPanelName;
      if (!bucketName) return;
      if (rootRect.height <= 0 || rootRect.width <= 0) {
        scheduleAccessProbe(bucketName);
        return;
      }
      const rowRect = node.getBoundingClientRect();
      if (rowRect.bottom >= viewportTop && rowRect.top <= viewportBottom) {
        scheduleAccessProbe(bucketName);
      }
    });

    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      rowNodes.forEach((node) => {
        const bucketName = node.dataset.bucketPanelName;
        if (bucketName) scheduleAccessProbe(bucketName);
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const bucketName = (entry.target as HTMLElement).dataset.bucketPanelName;
          if (bucketName) scheduleAccessProbe(bucketName);
          observer.unobserve(entry.target);
        });
      },
      { root, rootMargin: BUCKET_ACCESS_ROOT_MARGIN },
    );
    rowNodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [enabled, rows, scheduleAccessProbe]);

  useEffect(() => {
    if (!enabled || !canLoadMore) return;
    const root = panelViewportRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (
      !root ||
      !sentinel ||
      typeof window === "undefined" ||
      !("IntersectionObserver" in window)
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) onLoadMore();
        });
      },
      { root, rootMargin: BUCKET_LOAD_MORE_ROOT_MARGIN },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadMore, enabled, onLoadMore]);

  return { loadMoreSentinelRef, panelViewportRef };
}
