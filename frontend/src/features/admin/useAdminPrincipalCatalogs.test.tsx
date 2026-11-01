/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UiGroupSummary } from "../../api/groups";
import type { UserSummary } from "../../api/users";
import useAdminPrincipalCatalogs from "./useAdminPrincipalCatalogs";

const mocks = vi.hoisted(() => ({
  listUserOptions: vi.fn(),
  listGroupOptions: vi.fn(),
}));

vi.mock("../../api/users", () => ({
  listUserOptions: mocks.listUserOptions,
}));

vi.mock("../../api/groups", () => ({
  listGroupOptions: mocks.listGroupOptions,
}));

const user: UserSummary = {
  id: 1,
  email: "user@example.com",
  full_name: "Example User",
  avatar: null,
  role: "ui_user",
};
const group: UiGroupSummary = {
  id: 2,
  name: "Storage Team",
  system_key: null,
  avatar: {
    source: "initials",
    initials: "ST",
    icon: null,
    url: null,
    updated_at: null,
  },
};

describe("useAdminPrincipalCatalogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads paginated user and group catalogues and refreshes them on demand", async () => {
    mocks.listUserOptions.mockResolvedValue({ items: [user], total: 1, page: 1, page_size: 25, has_next: false });
    mocks.listGroupOptions.mockResolvedValue({ items: [group], total: 1, page: 1, page_size: 25, has_next: false });
    const { result } = renderHook(() => useAdminPrincipalCatalogs());

    await waitFor(() => {
      expect(result.current.users).toEqual([user]);
      expect(result.current.groups).toEqual([group]);
    });
    expect(result.current.groupsLoading).toBe(false);
    expect(mocks.listUserOptions).toHaveBeenCalledWith({ page: 1, page_size: 25 });
    expect(mocks.listGroupOptions).toHaveBeenCalledWith({ page: 1, page_size: 25 });

    await act(async () => {
      await Promise.all([result.current.loadUsers(), result.current.loadGroups()]);
    });
    await waitFor(() => {
      expect(mocks.listUserOptions).toHaveBeenCalledTimes(2);
      expect(mocks.listGroupOptions).toHaveBeenCalledTimes(2);
    });
  });

  it("retries a failed catalogue load on the next request", async () => {
    mocks.listUserOptions
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({ items: [user], total: 1, page: 1, page_size: 25, has_next: false });
    mocks.listGroupOptions.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25, has_next: false });
    const { result } = renderHook(() => useAdminPrincipalCatalogs());

    await waitFor(() => {
      expect(mocks.listUserOptions).toHaveBeenCalledTimes(1);
    });
    expect(result.current.users).toEqual([]);

    await act(async () => {
      await result.current.loadUsers();
    });
    await waitFor(() => expect(result.current.users).toEqual([user]));
    expect(mocks.listUserOptions).toHaveBeenCalledTimes(2);
  });
});
