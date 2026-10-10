/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from "vitest";

import { currentUser, type DemoRequest } from "./http";
import { iam } from "./iam";
import { createSeed } from "./state";

describe("demo IAM mutations", () => {
  it("creates managed policy ARNs with the IAM policy resource name", async () => {
    const state = createSeed();
    const account = state.accounts[0];
    const url = new URL(`https://demo.test/manager/iam/policies?ctx=${account.id}`);
    const request: DemoRequest = {
      state,
      url,
      path: "/manager/iam/policies",
      method: "POST",
      body: { name: "qa-policy", document: { Version: "2012-10-17", Statement: [] } },
      request: new Request(url),
      persona: "manager",
      user: currentUser(state, "manager"),
    };

    const response = iam(request);

    expect(response?.status).toBe(201);
    expect(await response!.json()).toMatchObject({
      name: "qa-policy",
      arn: `arn:aws:iam::${account.rgw_account_id}:policy/qa-policy`,
    });
  });
});
