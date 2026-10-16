/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";
import { buildCephConnectionDefaults } from "./s3ConnectionFromKey";

describe("buildCephConnectionDefaults", () => {
  it("keeps Ceph tenant and RGW Account ID independent", () => {
    const defaults = buildCephConnectionDefaults("alice", "ACCESS-1234", {
      accountId: "RGW00000000000000001",
      tenant: "team_a",
    });

    expect(defaults.rgwIdentity).toEqual({
      userUid: "alice",
      tenant: "team_a",
      accountId: "RGW00000000000000001",
    });
    expect(defaults.name).toBe("ceph-alice-1234");
  });

  it("uses the default tenant without fabricating an account identity", () => {
    const defaults = buildCephConnectionDefaults("bob", "ACCESS-9876");

    expect(defaults.rgwIdentity).toEqual({
      userUid: "bob",
      tenant: "",
      accountId: null,
    });
  });
});
