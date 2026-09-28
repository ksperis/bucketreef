/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { normalizePrefix } from "./browserUtils";

type BrowserNavigationLocation = {
  bucketName: string;
  prefix: string;
};

type BrowserHistoryState = BrowserNavigationLocation & {
  browserPage: true;
};

type PendingRouteLocation = {
  location: BrowserNavigationLocation;
  awaitingStateUpdate: boolean;
  waitingForBucketValidation: boolean;
  sawValidation: boolean;
};

type UseBrowserNavigationHistoryOptions = BrowserNavigationLocation & {
  lockedBucketName?: string;
  onNavigate: (location: BrowserNavigationLocation) => boolean | void;
  ready: boolean;
  scopeKey: string | null;
};

const sameBrowserLocation = (
  left: BrowserNavigationLocation,
  right: BrowserNavigationLocation,
) => left.bucketName === right.bucketName && left.prefix === right.prefix;

function readBrowserLocation(search: string): BrowserNavigationLocation {
  const params = new URLSearchParams(search);
  return {
    bucketName: params.get("bucket")?.trim() ?? "",
    prefix: normalizePrefix(params.get("prefix") ?? ""),
  };
}

export function buildBrowserLocationPath(
  pathname: string,
  search: string,
  hash: string,
  location: BrowserNavigationLocation,
): string {
  const params = new URLSearchParams(search);
  if (location.bucketName) {
    params.set("bucket", location.bucketName);
  } else {
    params.delete("bucket");
  }
  if (location.bucketName && location.prefix) {
    params.set("prefix", normalizePrefix(location.prefix));
  } else {
    params.delete("prefix");
  }
  const nextSearch = params.toString();
  return `${pathname}${nextSearch ? `?${nextSearch}` : ""}${hash}`;
}

export function useBrowserNavigationHistory({
  bucketName,
  prefix,
  lockedBucketName = "",
  onNavigate,
  ready,
  scopeKey,
}: UseBrowserNavigationHistoryOptions): void {
  const navigate = useNavigate();
  const route = useLocation();
  const navigateRef = useRef(navigate);
  const currentLocationRef = useRef<BrowserNavigationLocation>({
    bucketName,
    prefix,
  });
  const onNavigateRef = useRef(onNavigate);
  const initializedRef = useRef(false);
  const scopeKeyRef = useRef(scopeKey);
  const processedRoutePathRef = useRef("");
  const pendingRouteRef = useRef<PendingRouteLocation | null>(null);
  const replaceNextWriteRef = useRef(false);

  navigateRef.current = navigate;
  currentLocationRef.current = { bucketName, prefix: normalizePrefix(prefix) };
  onNavigateRef.current = onNavigate;

  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) return;
    scopeKeyRef.current = scopeKey;
    initializedRef.current = false;
    processedRoutePathRef.current = "";
    pendingRouteRef.current = null;
    replaceNextWriteRef.current = false;
  }, [scopeKey]);

  useEffect(() => {
    if (ready || !pendingRouteRef.current) return;
    pendingRouteRef.current.sawValidation = true;
  }, [ready]);

  useEffect(() => {
    const currentRoutePath = `${route.pathname}${route.search}${route.hash}`;
    if (!ready || processedRoutePathRef.current === currentRoutePath) return;
    processedRoutePathRef.current = currentRoutePath;
    if (!initializedRef.current) return;
    const routeLocation = readBrowserLocation(route.search);
    const currentLocation = currentLocationRef.current;
    const canonicalRoutePath = buildBrowserLocationPath(
      route.pathname,
      route.search,
      route.hash,
      routeLocation,
    );

    if (
      lockedBucketName &&
      routeLocation.bucketName !== lockedBucketName
    ) {
      pendingRouteRef.current = null;
      replaceNextWriteRef.current = true;
      return;
    }
    if (sameBrowserLocation(routeLocation, currentLocation)) {
      if (canonicalRoutePath !== currentRoutePath) {
        replaceNextWriteRef.current = true;
      }
      return;
    }

    pendingRouteRef.current = {
      location: routeLocation,
      awaitingStateUpdate: true,
      waitingForBucketValidation:
        routeLocation.bucketName !== currentLocation.bucketName,
      sawValidation: false,
    };
    const accepted = onNavigateRef.current(routeLocation);
    if (accepted === false) {
      pendingRouteRef.current = null;
    }
  }, [lockedBucketName, ready, route.hash, route.pathname, route.search]);

  useEffect(() => {
    if (!ready) return;
    const currentLocation = currentLocationRef.current;
    const routeLocation = readBrowserLocation(route.search);
    const currentRoutePath = `${route.pathname}${route.search}${route.hash}`;
    const nextPath = buildBrowserLocationPath(
      route.pathname,
      route.search,
      route.hash,
      currentLocation,
    );
    const nextState = {
      ...(route.state ?? {}),
      browserPage: true,
      ...currentLocation,
    } satisfies BrowserHistoryState;

    if (!initializedRef.current) {
      initializedRef.current = true;
      pendingRouteRef.current = null;
      replaceNextWriteRef.current = false;
      if (nextPath !== currentRoutePath) {
        navigateRef.current(nextPath, { replace: true, state: nextState });
      }
      return;
    }

    const pendingRoute = pendingRouteRef.current;
    if (pendingRoute) {
      if (pendingRoute.awaitingStateUpdate) {
        pendingRoute.awaitingStateUpdate = false;
        return;
      }
      if (sameBrowserLocation(pendingRoute.location, currentLocation)) {
        pendingRouteRef.current = null;
        return;
      }
      if (
        pendingRoute.waitingForBucketValidation &&
        !pendingRoute.sawValidation
      ) {
        return;
      }
      pendingRouteRef.current = null;
      replaceNextWriteRef.current = true;
    }

    if (
      sameBrowserLocation(routeLocation, currentLocation) &&
      nextPath === currentRoutePath
    ) {
      replaceNextWriteRef.current = false;
      return;
    }
    const replace = replaceNextWriteRef.current;
    replaceNextWriteRef.current = false;
    navigateRef.current(nextPath, { replace, state: nextState });
  }, [
    bucketName,
    prefix,
    ready,
    route.hash,
    route.pathname,
    route.search,
    route.state,
  ]);
}
