import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./useMediaQuery";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
  });
});

describe("useMediaQuery", () => {
  it("subscribes to modern media-query changes and removes the listener", () => {
    let matches = false;
    const listeners = new Set<() => void>();
    function addEventListener<K extends keyof MediaQueryListEventMap>(
      _type: K,
      listener: (this: MediaQueryList, event: MediaQueryListEventMap[K]) => unknown,
      _options?: boolean | AddEventListenerOptions,
    ): void;
    function addEventListener(
      _type: string,
      listener: EventListenerOrEventListenerObject,
      _options?: boolean | AddEventListenerOptions,
    ): void;
    function addEventListener(_type: string, listener: unknown): void {
      if (typeof listener === "function") listeners.add(listener as () => void);
    }
    function removeEventListener<K extends keyof MediaQueryListEventMap>(
      _type: K,
      listener: (this: MediaQueryList, event: MediaQueryListEventMap[K]) => unknown,
      _options?: boolean | EventListenerOptions,
    ): void;
    function removeEventListener(
      _type: string,
      listener: EventListenerOrEventListenerObject,
      _options?: boolean | EventListenerOptions,
    ): void;
    function removeEventListener(_type: string, listener: unknown): void {
      if (typeof listener === "function") listeners.delete(listener as () => void);
    }
    const matchMedia = vi.fn((query: string): MediaQueryList => {
      const mediaQueryList = {
        get matches() {
          return matches;
        },
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener,
        removeEventListener,
        dispatchEvent: vi.fn(),
      } satisfies MediaQueryList;
      return mediaQueryList;
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia,
    });

    const { result, unmount } = renderHook(() =>
      useMediaQuery("(max-width: 767px)"),
    );
    expect(result.current).toBe(false);
    expect(matchMedia).toHaveBeenCalledWith("(max-width: 767px)");
    expect(listeners).toHaveLength(1);

    matches = true;
    act(() => listeners.forEach((listener) => listener()));
    expect(result.current).toBe(true);

    unmount();
    expect(listeners).toHaveLength(0);
  });

  it("uses the configured snapshot without subscribing when disabled", () => {
    const matchMedia = vi.fn();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia,
    });

    const { result } = renderHook(() =>
      useMediaQuery("(max-width: 767px)", {
        defaultMatches: true,
        enabled: false,
      }),
    );

    expect(result.current).toBe(true);
    expect(matchMedia).not.toHaveBeenCalled();
  });
});
