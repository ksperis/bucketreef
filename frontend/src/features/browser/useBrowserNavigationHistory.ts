/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

type BrowserNavigationLocation = {
  bucketName: string;
  prefix: string;
};

type BrowserHistoryState = BrowserNavigationLocation & {
  browserPage: true;
};

type UseBrowserNavigationHistoryOptions = BrowserNavigationLocation & {
  onNavigate: (location: BrowserNavigationLocation) => boolean | void;
};

function currentBrowserPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function useBrowserNavigationHistory({
  bucketName,
  prefix,
  onNavigate,
}: UseBrowserNavigationHistoryOptions): void {
  const navigate = useNavigate();
  const route = useLocation();
  const navigateRef = useRef(navigate);
  const routePathRef = useRef("");
  const routeStateRef = useRef<Record<string, unknown>>({});
  navigateRef.current = navigate;
  routePathRef.current = `${route.pathname}${route.search}${route.hash}`;
  routeStateRef.current = route.state ?? {};
  const browserPathRef = useRef("");
  const currentLocationRef = useRef<BrowserNavigationLocation>({
    bucketName,
    prefix,
  });
  const lastWrittenLocationRef = useRef<BrowserNavigationLocation | null>(null);
  const skipNextWriteRef = useRef(false);
  const onNavigateRef = useRef(onNavigate);

  currentLocationRef.current = { bucketName, prefix };
  onNavigateRef.current = onNavigate;

  useEffect(() => {
    if (typeof window === "undefined") return;
    browserPathRef.current = routePathRef.current;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = (event: PopStateEvent) => {
      // Router-owned history keeps its index and user state together. Raw
      // pushState entries can make later Portal form blockers miss a Back step.
      const state = event.state?.usr as Partial<BrowserHistoryState> | null;
      if (currentBrowserPath() !== browserPathRef.current) return;
      const currentLocation = currentLocationRef.current;
      if (state?.browserPage) {
        const nextLocation = {
          bucketName: state.bucketName ?? "",
          prefix: state.prefix ?? "",
        };
        const locationChanged =
          nextLocation.bucketName !== currentLocation.bucketName ||
          nextLocation.prefix !== currentLocation.prefix;
        const accepted = onNavigateRef.current(nextLocation);
        if (accepted === false) {
          navigateRef.current(browserPathRef.current, {
            state: {
              ...routeStateRef.current,
              browserPage: true,
              ...currentLocation,
            } satisfies BrowserHistoryState,
          });
          return;
        }
        skipNextWriteRef.current = locationChanged;
        return;
      }

      // Leaving the explorer belongs to the router and the destination page.
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const location = { bucketName, prefix };
    if (skipNextWriteRef.current) {
      skipNextWriteRef.current = false;
      lastWrittenLocationRef.current = location;
      return;
    }
    const lastLocation = lastWrittenLocationRef.current;
    if (
      lastLocation?.bucketName === bucketName &&
      lastLocation.prefix === prefix
    ) {
      return;
    }

    const baseState = routeStateRef.current;
    const nextState = {
      ...baseState,
      browserPage: true,
      ...location,
    } satisfies BrowserHistoryState;
    const path = routePathRef.current;
    browserPathRef.current = path;
    lastWrittenLocationRef.current = location;
    navigateRef.current(path, { state: nextState, replace: !lastLocation || !baseState?.browserPage });
  }, [bucketName, prefix]);
}
