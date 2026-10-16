/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from "vitest";

import { currentUser, type DemoRequest } from "./http";
import { iam } from "./iam";
import { createSeed } from "./state";

describe("demo IAM mutations", () => {
  const request = (
    state: ReturnType<typeof createSeed>,
    path: string,
    method: string,
    body: Record<string, unknown> | unknown[] = {},
  ): DemoRequest => {
    const account = state.accounts[0];
    const url = new URL(`https://demo.test${path}?context_id=${account.id}`);
    return {
      state,
      url,
      path,
      method,
      body: body as Record<string, unknown>,
      request: new Request(url),
      persona: "manager",
      user: currentUser(state, "manager"),
    };
  };

  it("creates managed policy ARNs with the IAM policy resource name", async () => {
    const state = createSeed();
    const account = state.accounts[0];
    const response = iam(request(state, "/manager/iam/policies", "POST", {
      name: "qa-policy",
      document: { Version: "2012-10-17", Statement: [] },
    }));

    expect(response?.status).toBe(201);
    expect(await response!.json()).toMatchObject({
      name: "qa-policy",
      arn: `arn:aws:iam::${account.rgw_account_id}:policy/qa-policy`,
    });
  });

  it("renames an IAM user while keeping its dependent demo state addressable", async () => {
    const state = createSeed();
    const user = state.iam[state.accounts[0].id].users[0];
    state.iam[state.accounts[0].id].keys[user.name] = [{ access_key_id: "DEMO1", status: "Active" }];
    const oldName = user.name;

    const response = iam(request(
      state,
      `/manager/iam/users/${encodeURIComponent(oldName)}`,
      "PUT",
      { name: "backup-renamed", path: "/renamed/" },
    ));

    expect(response?.status).toBe(200);
    expect(await response!.json()).toMatchObject({ name: "backup-renamed", path: "/renamed/" });
    expect(state.iam[state.accounts[0].id].keys[oldName]).toBeUndefined();
    expect(state.iam[state.accounts[0].id].keys["backup-renamed"]).toHaveLength(1);
  });

  it("supports multi-valued role tags and removes all values for one key", async () => {
    const state = createSeed();
    const role = state.iam[state.accounts[0].id].roles[0];
    const path = `/manager/iam/roles/${encodeURIComponent(role.name)}/tags`;

    const added = iam(request(state, path, "PUT", [
      { key: "team", value: "storage" },
      { key: "team", value: "research" },
    ]));
    expect(await added!.json()).toEqual(expect.arrayContaining([
      { key: "team", value: "storage" },
      { key: "team", value: "research" },
    ]));

    const removed = iam(request(state, `${path}/team`, "DELETE"));
    expect((await removed!.json()).filter((tag: { key: string }) => tag.key === "team")).toEqual([]);
  });
});
