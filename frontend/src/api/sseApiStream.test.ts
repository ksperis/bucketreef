/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { afterEach, describe, expect, it } from "vitest";

import client from "./client";
import { buildSseUrl } from "./sseApiStream";

const originalBaseUrl = client.defaults.baseURL;

afterEach(() => {
  client.defaults.baseURL = originalBaseUrl;
});

describe("buildSseUrl", () => {
  it("builds normalized API stream URLs with query parameters", () => {
    client.defaults.baseURL = "/api/";

    expect(
      buildSseUrl("/manager/jobs/stream", {
        context_id: "conn-7",
        limit: 25,
        skipped: undefined,
      }),
    ).toBe("/api/manager/jobs/stream?context_id=conn-7&limit=25");
  });

  it("preserves URLSearchParams encoding", () => {
    client.defaults.baseURL = "https://bucketreef.example/api";
    const params = new URLSearchParams({ search: "a b", tenant: "acme/dev" });

    expect(buildSseUrl("/ceph-admin/users/stream", params)).toBe(
      "https://bucketreef.example/api/ceph-admin/users/stream?search=a+b&tenant=acme%2Fdev",
    );
  });
});
