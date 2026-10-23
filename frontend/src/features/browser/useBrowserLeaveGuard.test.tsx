/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { act, render, waitFor } from "@testing-library/react";
import { transferableAbortController } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import { useBrowserLeaveGuard } from "./useBrowserLeaveGuard";

function GuardedBrowser({
  hasPendingOperations = true,
  hasUnsavedChanges = false,
  archiveInventoryActive = false,
}: {
  hasPendingOperations?: boolean;
  hasUnsavedChanges?: boolean;
  archiveInventoryActive?: boolean;
}) {
  useBrowserLeaveGuard({
    hasPendingOperations,
    hasUnsavedChanges,
    archiveInventoryActive,
  });
  return <p>Browser</p>;
}

beforeEach(() => {
  vi.stubGlobal("AbortController", function () {
    return transferableAbortController();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useBrowserLeaveGuard", () => {
  it("allows Browser query navigation while guarding a real route exit", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const router = createMemoryRouter(
      [
        { path: "/browser", element: <GuardedBrowser /> },
        { path: "/next", element: <p>Next</p> },
      ],
      { initialEntries: ["/browser?bucket=demo&prefix=incoming%2F"] },
    );
    render(<RouterProvider router={router} />);

    await act(async () => {
      await router.navigate("/browser?bucket=demo&prefix=archive%2F");
    });
    expect(router.state.location.pathname).toBe("/browser");
    expect(router.state.location.search).toBe("?bucket=demo&prefix=archive%2F");
    expect(confirm).not.toHaveBeenCalled();

    await act(async () => {
      void router.navigate("/next");
    });
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(router.state.location.pathname).toBe("/browser");

    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    router.dispose();
  });

  it("keeps query navigation guarded when the details drawer is dirty", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const router = createMemoryRouter(
      [
        {
          path: "/browser",
          element: (
            <GuardedBrowser
              hasPendingOperations={false}
              hasUnsavedChanges
            />
          ),
        },
      ],
      { initialEntries: ["/browser?bucket=demo&prefix=incoming%2F"] },
    );
    render(<RouterProvider router={router} />);

    await act(async () => {
      void router.navigate("/browser?bucket=demo&prefix=archive%2F");
    });
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(router.state.location.search).toBe("?bucket=demo&prefix=incoming%2F");

    router.dispose();
  });
});
