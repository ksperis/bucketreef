import { BrowserRouter, useNavigate } from "react-router-dom";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserNavigationHistory } from "./useBrowserNavigationHistory";

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

  it("anchors the current browser location and records subsequent navigation", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    const pushState = vi.spyOn(window.history, "pushState");
    const onNavigate = vi.fn();
    const { rerender } = renderHook(
      ({ prefix }) =>
        useBrowserNavigationHistory({
          bucketName: "bucket-a",
          prefix,
          onNavigate,
        }),
      { initialProps: { prefix: "" }, wrapper: BrowserRouter },
    );

    await waitFor(() => expect(replaceState).toHaveBeenCalledTimes(1));
    expect(replaceState).toHaveBeenCalledWith(
      expect.objectContaining({
        usr: { source: "route", browserPage: true, bucketName: "bucket-a", prefix: "" }, idx: 0,
      }),
      "",
      "/browser?view=objects#content",
    );

    rerender({ prefix: "folder/" });
    await waitFor(() => expect(pushState).toHaveBeenCalledTimes(1));
    expect(pushState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        usr: { source: "route", browserPage: true, bucketName: "bucket-a", prefix: "folder/" }, idx: 1,
      }),
      "",
      "/browser?view=objects#content",
    );
  });

  it("restores a popped browser location without writing it again", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const onNavigate = vi.fn();
    const { rerender } = renderHook(
      ({ prefix }) =>
        useBrowserNavigationHistory({
          bucketName: "bucket-a",
          prefix,
          onNavigate,
        }),
      { initialProps: { prefix: "folder/" }, wrapper: BrowserRouter },
    );
    await waitFor(() =>
      expect(window.history.state).toMatchObject({ usr: { browserPage: true } }),
    );
    pushState.mockClear();

    act(() => {
      window.dispatchEvent(
        new PopStateEvent("popstate", {
          state: { usr: {
            browserPage: true,
            bucketName: "bucket-a",
            prefix: "",
          } },
        }),
      );
    });
    expect(onNavigate).toHaveBeenCalledWith({
      bucketName: "bucket-a",
      prefix: "",
    });

    rerender({ prefix: "" });
    await act(async () => Promise.resolve());
    expect(pushState).not.toHaveBeenCalled();
  });

  it("re-anchors the current location when popped navigation is rejected", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const onNavigate = vi.fn(() => false);
    renderHook(() =>
      useBrowserNavigationHistory({
        bucketName: "bucket-a",
        prefix: "folder/",
        onNavigate,
      }),
      { wrapper: BrowserRouter },
    );
    await waitFor(() =>
      expect(window.history.state).toMatchObject({ usr: { browserPage: true } }),
    );
    pushState.mockClear();

    act(() => {
      window.dispatchEvent(
        new PopStateEvent("popstate", {
          state: { usr: {
            browserPage: true,
            bucketName: "bucket-a",
            prefix: "",
          } },
        }),
      );
    });

    expect(onNavigate).toHaveBeenCalledWith({
      bucketName: "bucket-a",
      prefix: "",
    });
    expect(pushState).toHaveBeenCalledWith(
      expect.objectContaining({
        usr: { source: "route", browserPage: true, bucketName: "bucket-a", prefix: "folder/" }, idx: 1,
      }),
      "",
      "/browser?view=objects#content",
    );
  });

  it("leaves router-owned navigation alone outside the explorer history", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const onNavigate = vi.fn();
    renderHook(() =>
      useBrowserNavigationHistory({
        bucketName: "bucket-a",
        prefix: "folder/",
        onNavigate,
      }),
      { wrapper: BrowserRouter },
    );
    await waitFor(() =>
      expect(window.history.state).toMatchObject({ usr: { browserPage: true } }),
    );
    pushState.mockClear();

    act(() => {
      window.history.replaceState(
        { source: "external" },
        "",
        window.location.href,
      );
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: { source: "external" } }),
      );
    });

    expect(pushState).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("keeps router indexes distinct when prefix history is followed by another page", async () => {
    const { result, rerender } = renderHook(({ prefix }) => {
      useBrowserNavigationHistory({ bucketName: "bucket-a", prefix, onNavigate: () => undefined });
      return useNavigate();
    }, { initialProps: { prefix: "" }, wrapper: BrowserRouter });
    expect(window.history.state.idx).toBe(0);
    rerender({ prefix: " leading//folder/" });
    expect(window.history.state.idx).toBe(1);
    expect(window.history.state.usr.prefix).toBe(" leading//folder/");
    await act(async () => { await result.current("/portal/requests"); });
    expect(window.history.state.idx).toBe(2);
    expect(window.location.pathname).toBe("/portal/requests");
  });
});
