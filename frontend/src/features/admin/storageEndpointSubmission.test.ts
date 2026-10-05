/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from "vitest";
import { createEmptyForm } from "./storageEndpointFormModel";
import { buildStorageEndpointSubmission } from "./storageEndpointSubmission";

describe("baseline Ceph service credentials", () => {
  it("requires external Supervision even with every collector disabled", () => {
    const form = createEmptyForm();
    Object.assign(form, { name: "Ceph", endpoint_url: "https://ceph.example.test", service_identity_mode: "external",
      admin_access_key: "ADMIN", admin_secret_key: "ADMIN-SECRET",
      runtime_access_key: "RUNTIME", runtime_secret_key: "RUNTIME-SECRET" });
    form.features.metrics.enabled = false;
    form.features.usage.enabled = false;
    form.features.healthcheck.enabled = false;
    expect(buildStorageEndpointSubmission(form, false).errors).toMatchObject({
      supervision_access_key: expect.any(String), supervision_secret_key: expect.any(String),
    });
    form.supervision_access_key = "SUPERVISION";
    form.supervision_secret_key = "SUPERVISION-SECRET";
    expect(buildStorageEndpointSubmission(form, false).payload).toMatchObject({
      runtime_access_key: "RUNTIME", supervision_access_key: "SUPERVISION",
    });
  });

  it("keeps both write-only stored pairs during an external metadata edit", () => {
    const form = createEmptyForm();
    Object.assign(form, { name: "Ceph", endpoint_url: "https://ceph.example.test", service_identity_mode: "external",
      admin_access_key: "ADMIN", has_admin_secret: true, has_runtime_secret: true, has_supervision_secret: true });
    const result = buildStorageEndpointSubmission(form, true);
    expect(result.errors).toBeUndefined();
    expect(result.payload).not.toHaveProperty("runtime_access_key");
    expect(result.payload).not.toHaveProperty("supervision_access_key");
  });
});
