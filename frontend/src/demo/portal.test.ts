/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from "vitest";

import type { PortalStorageSpaceSummary } from "../api/portal";
import { currentUser, type DemoRequest } from "./http";
import { portal } from "./portal";
import { createSeed, type Persona } from "./state";

function request(
  state: ReturnType<typeof createSeed>,
  path: string,
  method: string,
  body: Record<string, unknown> = {},
  persona: Persona = "project-manager",
): DemoRequest {
  const url = new URL(`https://demo.test${path}?account_id=${state.accounts[0].id}`);
  return {
    state,
    url,
    path,
    method,
    body,
    request: new Request(url),
    persona,
    user: currentUser(state, persona),
  };
}

describe("demo Portal request contract", () => {
  it.each(["intent", "portal_role"])(
    "rejects collaborator requests without canonical %s",
    (missingField) => {
      const state = createSeed();
      const body: Record<string, unknown> = {
        request_type: "portal_user_access",
        intent: "add",
        target_name: "New member",
        target_email: "new.member@example.test",
        portal_role: "portal_user",
      };
      delete body[missingField];

      expect(() => portal(request(state, "/portal/requests", "POST", body))).toThrow(
        missingField,
      );
    },
  );

  it("rejects noncanonical persisted collaborator requests during approval", () => {
    const state = createSeed();
    const stored = state.requests.find(item => item.request_type === "portal_user_access");
    expect(stored).toBeDefined();
    delete stored!.payload.intent;

    expect(() =>
      portal(request(state, `/admin/portal-requests/${stored!.id}/approve`, "POST", {}, "admin")),
    ).toThrow("intent");
  });

  it("keeps seeded collaborator requests canonical", () => {
    const state = createSeed();
    const collaboratorRequests = state.requests.filter(
      item => item.request_type === "portal_user_access",
    );

    expect(collaboratorRequests.length).toBeGreaterThan(0);
    for (const item of collaboratorRequests) {
      expect(item.payload).toMatchObject({ intent: "add", portal_role: "portal_user" });
    }
  });

  it("paginates and searches the Admin request queue like the real API", async () => {
    const state = createSeed();
    const uniqueRequest = {
      ...state.requests[0],
      id: state.nextId++,
      requester_email: "unique.admin.search@example.test",
      account_name: "Unique Search Account",
      payload: {
        ...state.requests[0].payload,
        target_email: "unique.target@example.test",
      },
    };
    state.requests.push(uniqueRequest);

    const paginated = request(state, "/admin/portal-requests", "GET", {}, "admin");
    paginated.url.searchParams.set("page_size", "1");
    expect(await portal(paginated)!.json()).toMatchObject({
      items: [{ id: uniqueRequest.id }],
      total: state.requests.length,
      page: 1,
      page_size: 1,
      has_next: true,
    });

    const searched = request(state, "/admin/portal-requests", "GET", {}, "admin");
    searched.url.searchParams.set("search", "unique.target@example.test");
    expect(await portal(searched)!.json()).toMatchObject({
      items: [{ id: uniqueRequest.id }],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });
  });

  it("mirrors canonical Storage Space filtering, derived status, and sorting", async () => {
    const state = createSeed();
    const accountId = state.accounts[0].id;
    const accountSpaces = state.spaces.filter(space => space.accountId === accountId);
    expect(accountSpaces.length).toBeGreaterThan(2);

    const archivedSpace = accountSpaces[0];
    archivedSpace.archived_at = "2026-11-01T00:00:00Z";
    const archivedRequest = request(state, "/portal/storage-spaces", "GET");
    archivedRequest.url.searchParams.set("include_archived", "true");
    archivedRequest.url.searchParams.set("status", "Archived");
    const archived = await portal(archivedRequest)!.json() as PortalStorageSpaceSummary[];
    expect(archived).toEqual([expect.objectContaining({ id: archivedSpace.id, status: "Archived" })]);

    const ownerRequest = request(state, "/portal/storage-spaces", "GET");
    ownerRequest.url.searchParams.set("role", "Owner");
    expect(await portal(ownerRequest)!.json()).toEqual([]);

    const sortedRequest = request(state, "/portal/storage-spaces", "GET");
    sortedRequest.url.searchParams.set("sort", "-name");
    const sorted = await portal(sortedRequest)!.json() as PortalStorageSpaceSummary[];
    const expectedNames = sorted.map(space => space.name).toSorted().reverse();
    expect(sorted.map(space => space.name)).toEqual(expectedNames);
  });

  it.each([
    ["role", "owner"],
    ["status", "active"],
    ["sort", "unknown"],
  ])("rejects noncanonical Storage Space %s query values", (field, value) => {
    const state = createSeed();
    const invalid = request(state, "/portal/storage-spaces", "GET");
    invalid.url.searchParams.set(field, value);

    expect(() => portal(invalid)).toThrow(`${field} must be one of`);
  });
});
