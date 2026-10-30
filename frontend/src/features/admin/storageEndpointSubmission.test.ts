/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from "vitest";
import { createEmptyForm } from "./storageEndpointFormModel";
import { buildStorageEndpointSubmission } from "./storageEndpointSubmission";

describe("feature-dependent Ceph service credentials", () => {
  it("accepts missing Supervision with every collector disabled", () => {
    const form = createEmptyForm();
    Object.assign(form, { name: "Ceph", endpoint_url: "https://ceph.example.test", service_identity_mode: "external",
      admin_access_key: "ADMIN", admin_secret_key: "ADMIN-SECRET",
      runtime_access_key: "RUNTIME", runtime_secret_key: "RUNTIME-SECRET" });
    form.features.metrics.enabled = false;
    form.features.usage.enabled = false;
    form.features.healthcheck.enabled = false;
    expect(buildStorageEndpointSubmission(form, false).errors).toBeUndefined();
    form.supervision_access_key = "SUPERVISION";
    form.supervision_secret_key = "SUPERVISION-SECRET";
    expect(buildStorageEndpointSubmission(form, false).payload).toMatchObject({
      runtime_access_key: "RUNTIME", supervision_access_key: "SUPERVISION",
    });
  });

  it("enables the signed S3 healthcheck when external Supervision credentials are supplied", () => {
    const form = createEmptyForm();
    Object.assign(form, {
      name: "Ceph",
      endpoint_url: "https://ceph.example.test",
      service_identity_mode: "external",
      runtime_access_key: "RUNTIME",
      runtime_secret_key: "RUNTIME-SECRET",
      supervision_access_key: "SUPERVISION",
      supervision_secret_key: "SUPERVISION-SECRET",
    });
    form.features.healthcheck.enabled = false;
    form.features.healthcheck.mode = "http";

    const result = buildStorageEndpointSubmission(form, false);

    expect(result.errors).toBeUndefined();
    expect(result.payload?.features?.healthcheck).toMatchObject({ enabled: true, mode: "s3" });
  });

  it("keeps the signed S3 healthcheck enabled when editing with stored external Supervision credentials", () => {
    const form = createEmptyForm();
    Object.assign(form, {
      name: "Ceph",
      endpoint_url: "https://ceph.example.test",
      service_identity_mode: "external",
      has_runtime_secret: true,
      has_supervision_secret: true,
    });
    form.features.healthcheck.enabled = false;
    form.features.healthcheck.mode = "http";

    const result = buildStorageEndpointSubmission(form, true);

    expect(result.errors).toBeUndefined();
    expect(result.payload?.features?.healthcheck).toMatchObject({ enabled: true, mode: "s3" });
  });

  it.each(["managed", "external"] as const)("saves Ceph Admin alone in %s mode", mode => {
    const form = createEmptyForm();
    Object.assign(form, { name: "Ceph", endpoint_url: "https://ceph.example.test", service_identity_mode: mode,
      ceph_admin_allowed: true, ceph_admin_access_key: "CEPH", ceph_admin_secret_key: "CEPH-SECRET" });
    const result = buildStorageEndpointSubmission(form, false);
    expect(result.errors).toBeUndefined();
    expect(result.payload).toMatchObject({ service_identity_mode: mode, ceph_admin_allowed: true });
  });

  it.each(["metrics", "usage", "healthcheck"] as const)("requires external Supervision for %s", feature => {
    const form = createEmptyForm();
    Object.assign(form, { name: "Ceph", endpoint_url: "https://ceph.example.test", service_identity_mode: "external" });
    form.features[feature].enabled = true;
    if (feature === "healthcheck") form.features.healthcheck.mode = "s3";
    const result = buildStorageEndpointSubmission(form, false);
    expect(result.errors).toHaveProperty("supervision_access_key");
    expect(result.errors).not.toHaveProperty("runtime_access_key");
  });

  it.each(["admin", "runtime", "supervision", "ceph_admin"] as const)("rejects a partial optional %s pair", kind => {
    const form = createEmptyForm();
    Object.assign(form, { name: "Ceph", endpoint_url: "https://ceph.example.test", service_identity_mode: "external" });
    form[`${kind}_access_key`] = "PARTIAL";
    expect(buildStorageEndpointSubmission(form, false).errors).toHaveProperty(`${kind}_secret_key`);
  });

  it("requires replacements for configured managed identities even with their features disabled", () => {
    const form = createEmptyForm();
    Object.assign(form, { name: "Ceph", endpoint_url: "https://ceph.example.test", service_identity_mode: "external" });
    const result = buildStorageEndpointSubmission(form, true, [
      { kind: "runtime", mode: "managed", status: "ready", credentials_configured: true },
      { kind: "supervision", mode: "managed", status: "ready", credentials_configured: true },
    ]);
    expect(result.errors).toHaveProperty("runtime_access_key");
    expect(result.errors).toHaveProperty("supervision_access_key");
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
  it("saves a manual Ceph Admin pair independently of managed Runtime/Supervision", () => {
    const form = createEmptyForm();
    Object.assign(form, { name: "Ceph", endpoint_url: "https://ceph.example.test", ceph_admin_allowed: true,
      admin_access_key: "ADMIN", admin_secret_key: "ADMIN-SK", ceph_admin_access_key: "CEPH-AK", ceph_admin_secret_key: "CEPH-SK" });
    expect(buildStorageEndpointSubmission(form, false).payload).toMatchObject({
      service_identity_mode: "managed", ceph_admin_allowed: true, ceph_admin_access_key: "CEPH-AK", ceph_admin_secret_key: "CEPH-SK",
    });
    form.ceph_admin_secret_key = "";
    expect(buildStorageEndpointSubmission(form, false).errors).toHaveProperty("ceph_admin_secret_key");
  });

  it("preserves the stored Ceph Admin pair while disabling authorization", () => {
    const form = createEmptyForm();
    Object.assign(form, { name: "Ceph", endpoint_url: "https://ceph.example.test", has_ceph_admin_secret: true,
      admin_access_key: "ADMIN", has_admin_secret: true });
    const result = buildStorageEndpointSubmission(form, true);
    expect(result.payload).toHaveProperty("ceph_admin_allowed", false);
    expect(result.payload).not.toHaveProperty("ceph_admin_access_key");
    expect(result.payload).not.toHaveProperty("ceph_admin_secret_key");
    form.ceph_admin_secret_key = "REPLACEMENT";
    expect(buildStorageEndpointSubmission(form, true).errors).toHaveProperty("ceph_admin_access_key");
  });

  it("requires Realm ID and Zonegroup ID together for Ceph endpoints", () => {
    const form = createEmptyForm();
    Object.assign(form, {
      name: "Ceph multisite",
      endpoint_url: "https://ceph-multisite.example.test",
      service_identity_mode: "external",
      realm_id: "realm-a",
    });
    form.features.metrics.enabled = false;
    form.features.usage.enabled = false;
    form.features.healthcheck.enabled = false;

    const missingZonegroup = buildStorageEndpointSubmission(form, false);
    expect(missingZonegroup.errors).toHaveProperty("zonegroup_id");

    form.realm_id = "";
    form.zonegroup_id = "zonegroup-a";
    const missingRealm = buildStorageEndpointSubmission(form, false);
    expect(missingRealm.errors).toHaveProperty("realm_id");
  });

  it("normalizes Ceph multisite topology and clears it for non-Ceph providers", () => {
    const form = createEmptyForm();
    Object.assign(form, {
      name: "Ceph multisite",
      endpoint_url: "https://ceph-multisite.example.test",
      service_identity_mode: "external",
      realm_id: "  realm-a  ",
      zonegroup_id: "  zonegroup-a  ",
      zone_id: "  zone-a  ",
    });
    form.features.metrics.enabled = false;
    form.features.usage.enabled = false;
    form.features.healthcheck.enabled = false;

    const ceph = buildStorageEndpointSubmission(form, false);
    expect(ceph.errors).toBeUndefined();
    expect(ceph.payload).toMatchObject({
      realm_id: "realm-a",
      zonegroup_id: "zonegroup-a",
      zone_id: "zone-a",
    });

    form.provider = "other";
    const other = buildStorageEndpointSubmission(form, false);
    expect(other.payload).toMatchObject({ realm_id: null, zonegroup_id: null, zone_id: null });
  });

});
