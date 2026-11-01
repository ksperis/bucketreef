/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";
import type { UiGroupSummary } from "../../api/groups";
import { deriveAdminUserAssociationOptions } from "./useAdminUserAssociationDerivedOptions";

const group = (id: number, name: string, systemKey: string | null = null): UiGroupSummary => ({
  id,
  name,
  system_key: systemKey,
  avatar: {
    source: "initials",
    initials: name.slice(0, 2).toUpperCase(),
    icon: null,
    url: null,
    updated_at: null,
  },
});

describe("deriveAdminUserAssociationOptions", () => {
  it("shares selection, search, system-group, and visibility rules across editors", () => {
    const result = deriveAdminUserAssociationOptions(
      {
        accounts: {
          selected: [{
            id: 2,
            manager_role: "account_administrator",
            portal_role: null,
            allow_manager_browser_data_access: false,
          }],
          picker: { search: "  PROD " },
        },
        s3Users: {
          selected: [{ s3_user_id: 11, allow_manager_browser_data_access: false }],
          picker: { search: "user" },
        },
        connections: {
          selected: [21],
          picker: { search: "CONN" },
        },
        openStack: {
          selected: [31],
          picker: { search: "cloud" },
        },
        groups: {
          selected: [41],
          picker: { search: "OPS" },
        },
      },
      {
        accountOptions: [
          { id: 1, label: "Prod North" },
          { id: 2, label: "Prod South" },
          { id: 3, label: "Development" },
        ],
        s3UserOptions: [
          { id: 11, label: "User One" },
          { id: 12, label: "User Two" },
          { id: 13, label: "Robot" },
        ],
        s3ConnectionOptions: [
          { id: 21, label: "Conn One" },
          { id: 22, label: "Conn Two" },
          { id: 23, label: "Archive" },
        ],
        openStackOptions: [
          { id: 31, label: "Cloud One" },
          { id: 32, label: "Cloud Two" },
          { id: 33, label: "Region" },
        ],
        groups: [
          group(41, "Ops Team"),
          group(42, "Ops Readonly"),
          group(43, "Ops System", "platform-admins"),
          group(44, "Developers"),
        ],
      },
      1,
    );

    expect(result.accounts.available.map((option) => option.id)).toEqual([1]);
    expect(result.s3Users.available.map((option) => option.id)).toEqual([12]);
    expect(result.connections.available.map((option) => option.id)).toEqual([22]);
    expect(result.openStack.available.map((option) => option.id)).toEqual([32]);
    expect(result.groups.map((item) => item.id)).toEqual([42]);
    expect(result.accounts.visible.map((option) => option.id)).toEqual([1]);
    expect(result.s3Users.visible.map((option) => option.id)).toEqual([12]);
    expect(result.connections.visible.map((option) => option.id)).toEqual([22]);
    expect(result.openStack.visible.map((option) => option.id)).toEqual([32]);
  });

  it("limits visible storage options without changing the available count", () => {
    const result = deriveAdminUserAssociationOptions(
      {
        accounts: { selected: [], picker: { search: "" } },
        s3Users: { selected: [], picker: { search: "" } },
        connections: { selected: [], picker: { search: "" } },
        openStack: { selected: [], picker: { search: "" } },
        groups: { selected: [], picker: { search: "" } },
      },
      {
        accountOptions: [
          { id: 1, label: "One" },
          { id: 2, label: "Two" },
          { id: 3, label: "Three" },
        ],
        s3UserOptions: [],
        s3ConnectionOptions: [],
        openStackOptions: [],
        groups: [],
      },
      2,
    );

    expect(result.accounts.available).toHaveLength(3);
    expect(result.accounts.visible.map((option) => option.id)).toEqual([1, 2]);
  });
});
