/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useAdminPrincipalEditRequest,
  useOpenRequestedAdminPrincipal,
} from "./useAdminPrincipalEditRequest";

describe("useAdminPrincipalEditRequest", () => {
  const originalUrl = window.location.href;

  afterEach(() => {
    window.history.replaceState(window.history.state, "", originalUrl);
  });

  it("reads the initial principal edit request from the current URL", () => {
    window.history.replaceState(window.history.state, "", "/admin/users?edit=7&search=alice");

    const { result } = renderHook(() => useAdminPrincipalEditRequest());

    expect(result.current).toEqual({ id: 7, search: "alice" });
  });

  it("opens the requested item once when it becomes available", () => {
    const firstOpen = vi.fn();
    const secondOpen = vi.fn();
    const request = { id: 7, search: "alice" };
    const { rerender } = renderHook(
      ({ items, openItem }) => useOpenRequestedAdminPrincipal(request, items, openItem),
      {
        initialProps: {
          items: [] as Array<{ id: number; name: string }>,
          openItem: firstOpen,
        },
      },
    );

    rerender({
      items: [{ id: 7, name: "Alice" }],
      openItem: secondOpen,
    });
    rerender({
      items: [{ id: 7, name: "Alice" }],
      openItem: secondOpen,
    });

    expect(firstOpen).not.toHaveBeenCalled();
    expect(secondOpen).toHaveBeenCalledTimes(1);
    expect(secondOpen).toHaveBeenCalledWith({ id: 7, name: "Alice" });
  });
});
