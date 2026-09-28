import { BrowserRouter, useNavigate } from "react-router-dom";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildBrowserLocationPath,
  useBrowserNavigationHistory,
} from "./useBrowserNavigationHistory";

describe("useBrowserNavigationHistory", () => {
  beforeEach(() => {
    window.history.replaceState(
      { usr: { source: "route" }, key: "initial", idx: 0 },
      "",
      "/browser?view=objects#content",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replaces the initial URL and pushes subsequent user navigation", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    const pushState = vi.spyOn(window.history, "pushState");
    const onNavigate = vi.fn();
    const { rerender } = renderHook(
      ({ prefix }) =>
        useBrowserNavigationHistory({
          bucketName: "bucket-a",
          prefix,
          onNavigate,
          ready: true,
          scopeKey: "browser:account-a",
        }),
      { initialProps: { prefix: "" }, wrapper: BrowserRouter },
    );

    await waitFor(() =>
      expect(window.location.href).toContain(
        "/browser?view=objects&bucket=bucket-a#content",
      ),
    );
    expect(replaceState).toHaveBeenCalledWith(
      expect.objectContaining({
        usr: {
          source: "route",
          browserPage: true,
          bucketName: "bucket-a",
          prefix: "",
        },
        idx: 0,
      }),
      "",
      "/browser?view=objects&bucket=bucket-a#content",
    );

    rerender({ prefix: "folder/" });
    await waitFor(() =>
      expect(window.location.href).toContain(
        "/browser?view=objects&bucket=bucket-a&prefix=folder%2F#content",
      ),
    );
    expect(pushState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        usr: {
          source: "route",
          browserPage: true,
          bucketName: "bucket-a",
          prefix: "folder/",
        },
        idx: 1,
      }),
      "",
      "/browser?view=objects&bucket=bucket-a&prefix=folder%2F#content",
    );
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("restores Back and Forward locations without echoing a new entry", async () => {
    const onNavigate = vi.fn();
    const pushState = vi.spyOn(window.history, "pushState");
    window.history.replaceState(
      { usr: {}, key: "initial", idx: 0 },
      "",
      "/manager/browser?ctx=ctx-1&bucket=bucket-a&prefix=folder%2F#objects",
    );
    const { result, rerender } = renderHook(
      ({ prefix }) => {
        useBrowserNavigationHistory({
          bucketName: "bucket-a",
          prefix,
          onNavigate,
          ready: true,
          scopeKey: "manager:ctx-1",
        });
        return useNavigate();
      },
      { initialProps: { prefix: "folder/" }, wrapper: BrowserRouter },
    );
    pushState.mockClear();

    await act(async () => {
      await result.current(
        "/manager/browser?ctx=ctx-1&bucket=bucket-a#objects",
      );
    });
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith({
        bucketName: "bucket-a",
        prefix: "",
      }),
    );
    pushState.mockClear();

    rerender({ prefix: "" });
    await act(async () => Promise.resolve());
    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?ctx=ctx-1&bucket=bucket-a");
    expect(window.location.hash).toBe("#objects");
  });

  it("re-anchors the current URL when covered navigation is rejected", async () => {
    const onNavigate = vi.fn(() => false);
    window.history.replaceState(
      { usr: {}, key: "initial", idx: 0 },
      "",
      "/browser?bucket=bucket-a&prefix=folder%2F",
    );
    const { result } = renderHook(() => {
      useBrowserNavigationHistory({
        bucketName: "bucket-a",
        prefix: "folder/",
        onNavigate,
        ready: true,
        scopeKey: "browser:account-a",
      });
      return useNavigate();
    }, { wrapper: BrowserRouter });

    await act(async () => {
      await result.current("/browser?bucket=bucket-a");
    });
    await waitFor(() =>
      expect(window.location.search).toBe(
        "?bucket=bucket-a&prefix=folder%2F",
      ),
    );
    expect(onNavigate).toHaveBeenCalledWith({
      bucketName: "bucket-a",
      prefix: "",
    });
    expect(window.history.state.idx).toBe(2);
  });

  it("replaces an invalid bucket after catalogue validation", async () => {
    const onNavigate = vi.fn();
    window.history.replaceState(
      { usr: {}, key: "initial", idx: 0 },
      "",
      "/browser?ctx=ctx-1&bucket=bucket-a#objects",
    );
    const { result, rerender } = renderHook(
      ({ ready }) => {
        useBrowserNavigationHistory({
          bucketName: "bucket-a",
          prefix: "",
          onNavigate,
          ready,
          scopeKey: "browser:ctx-1",
        });
        return useNavigate();
      },
      { initialProps: { ready: true }, wrapper: BrowserRouter },
    );

    await act(async () => {
      await result.current(
        "/browser?ctx=ctx-1&bucket=missing&prefix=docs%2F#objects",
      );
    });
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith({
        bucketName: "missing",
        prefix: "docs/",
      }),
    );
    rerender({ ready: false });
    rerender({ ready: true });

    await waitFor(() =>
      expect(window.location.href).toContain(
        "/browser?ctx=ctx-1&bucket=bucket-a#objects",
      ),
    );
    expect(window.history.state.idx).toBe(1);
  });

  it("forces the locked bucket and keeps the requested prefix", async () => {
    window.history.replaceState(
      { usr: {}, key: "initial", idx: 0 },
      "",
      "/portal/spaces/7?project=project-a&bucket=other&prefix=docs%2F#files",
    );
    renderHook(
      () =>
        useBrowserNavigationHistory({
          bucketName: "locked-bucket",
          prefix: "docs/",
          lockedBucketName: "locked-bucket",
          onNavigate: vi.fn(),
          ready: true,
          scopeKey: "portal:project-a:locked-bucket",
        }),
      { wrapper: BrowserRouter },
    );

    await waitFor(() =>
      expect(window.location.href).toContain(
        "/portal/spaces/7?project=project-a&bucket=locked-bucket&prefix=docs%2F#files",
      ),
    );
    expect(window.history.state.idx).toBe(0);
  });

  it("keeps a matching deep link stable on initial load", async () => {
    const onNavigate = vi.fn();
    window.history.replaceState(
      { usr: {}, key: "initial", idx: 0 },
      "",
      "/ceph-admin/browser?ep=9&bucket=logs&prefix=2026%2F#objects",
    );
    renderHook(
      () =>
        useBrowserNavigationHistory({
          bucketName: "logs",
          prefix: "2026/",
          onNavigate,
          ready: true,
          scopeKey: "ceph-admin:9",
        }),
      { wrapper: BrowserRouter },
    );
    await act(async () => Promise.resolve());

    expect(window.location.search).toBe(
      "?ep=9&bucket=logs&prefix=2026%2F",
    );
    expect(window.location.hash).toBe("#objects");
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("buildBrowserLocationPath", () => {
  it.each([
    ["/browser", "?ctx=7", "#main"],
    ["/manager/browser", "?ctx=7", "#manager"],
    ["/ceph-admin/browser", "?ep=9", "#ceph"],
    ["/portal/spaces/3", "?project=12", "#files"],
  ])("preserves context and fragments on %s", (pathname, search, hash) => {
    expect(
      buildBrowserLocationPath(pathname, search, hash, {
        bucketName: "bucket-a",
        prefix: "docs/",
      }),
    ).toBe(
      `${pathname}${search}&bucket=bucket-a&prefix=docs%2F${hash}`,
    );
  });

  it("omits root prefixes and removes orphaned locations", () => {
    expect(
      buildBrowserLocationPath(
        "/browser",
        "?ctx=7&bucket=old&prefix=docs%2F",
        "",
        { bucketName: "bucket-a", prefix: "" },
      ),
    ).toBe("/browser?ctx=7&bucket=bucket-a");
    expect(
      buildBrowserLocationPath(
        "/browser",
        "?ctx=7&bucket=old&prefix=docs%2F",
        "",
        { bucketName: "", prefix: "ignored/" },
      ),
    ).toBe("/browser?ctx=7");
  });
});
