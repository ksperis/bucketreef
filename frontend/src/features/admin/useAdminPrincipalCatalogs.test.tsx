/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UiGroupSummary } from "../../api/groups";
import type { UserSummary } from "../../api/users";
import useAdminPrincipalCatalogs from "./useAdminPrincipalCatalogs";

const mocks = vi.hoisted(() => ({
  listMinimalUsers: vi.fn(),
  listMinimalGroups: vi.fn(),
}));

vi.mock("../../api/users", () => ({
  listMinimalUsers: mocks.listMinimalUsers,
}));

vi.mock("../../api/groups", () => ({
  listMinimalGroups: mocks.listMinimalGroups,
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

  it("loads and caches the user and group catalogues", async () => {
    mocks.listMinimalUsers.mockResolvedValue([user]);
    mocks.listMinimalGroups.mockResolvedValue([group]);
    const { result } = renderHook(() => useAdminPrincipalCatalogs());

    await act(async () => {
      await Promise.all([result.current.loadUsers(), result.current.loadGroups()]);
    });

    expect(result.current.users).toEqual([user]);
    expect(result.current.groups).toEqual([group]);
    expect(result.current.groupsLoading).toBe(false);

    await act(async () => {
      await Promise.all([result.current.loadUsers(), result.current.loadGroups()]);
    });
    expect(mocks.listMinimalUsers).toHaveBeenCalledTimes(1);
    expect(mocks.listMinimalGroups).toHaveBeenCalledTimes(1);
  });

  it("retries a failed catalogue load on the next request", async () => {
    mocks.listMinimalUsers
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce([user]);
    mocks.listMinimalGroups.mockResolvedValue([]);
    const { result } = renderHook(() => useAdminPrincipalCatalogs());

    await act(async () => {
      await result.current.loadUsers();
    });
    expect(result.current.users).toEqual([]);

    await act(async () => {
      await result.current.loadUsers();
    });
    expect(result.current.users).toEqual([user]);
    expect(mocks.listMinimalUsers).toHaveBeenCalledTimes(2);
  });
});
