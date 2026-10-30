import { describe, expect, it } from "vitest";
import {
  applyFeatureConstraints,
  awsCoordinatesForRegion,
  awsIamEndpointForRegion,
  awsS3EndpointForRegion,
  awsStsEndpointForRegion,
  buildFeaturesPayload,
  createEmptyForm,
  createFormFromEndpoint,
  defaultFeaturesForProvider,
  normalizeAwsRegion,
  parseCoordinateInput,
} from "./storageEndpointFormModel";
import type { StorageEndpoint } from "../../api/storageEndpoints";

describe("storage endpoint form model", () => {
  it("normalizes AWS regions and resolves partition endpoints", () => {
    expect(normalizeAwsRegion(" EU-West-3 ")).toBe("eu-west-3");
    expect(normalizeAwsRegion(" ")).toBe("us-east-1");
    expect(awsS3EndpointForRegion("eu-west-3")).toBe(
      "https://s3.eu-west-3.amazonaws.com",
    );
    expect(awsStsEndpointForRegion("cn-north-1")).toBe(
      "https://sts.cn-north-1.amazonaws.com.cn",
    );
    expect(awsIamEndpointForRegion("us-gov-west-1")).toBe(
      "https://iam.us-gov.amazonaws.com",
    );
    expect(awsIamEndpointForRegion("cn-northwest-1")).toBe(
      "https://iam.cn-north-1.amazonaws.com.cn",
    );
  });

  it("resolves known AWS coordinates without inventing unknown locations", () => {
    expect(awsCoordinatesForRegion("eu-west-3")).toEqual({
      latitude: "48.8566",
      longitude: "2.3522",
    });
    expect(awsCoordinatesForRegion("future-region-1")).toBeNull();
  });

  it("applies provider constraints without mutating the source features", () => {
    const source = defaultFeaturesForProvider("aws", "eu-west-3");
    source.admin.enabled = true;
    source.account.enabled = true;
    source.replication.enabled = true;
    source.healthcheck.mode = "s3";

    const constrained = applyFeatureConstraints(source, "aws");

    expect(constrained.admin.enabled).toBe(false);
    expect(constrained.account.enabled).toBe(false);
    expect(constrained.replication.enabled).toBe(false);
    expect(constrained.healthcheck.mode).toBe("http");
    expect(source.admin.enabled).toBe(true);
    expect(source.healthcheck.mode).toBe("s3");
  });

  it("builds structured endpoint overrides and healthcheck settings", () => {
    const features = defaultFeaturesForProvider("aws", "eu-west-3");
    features.healthcheck.endpoint = " https://health.example.test/status ";

    const payload = buildFeaturesPayload(features);

    expect(payload.sts).toEqual({
      enabled: true,
      endpoint: "https://sts.eu-west-3.amazonaws.com",
    });
    expect(payload.iam).toEqual({
      enabled: true,
      endpoint: "https://iam.amazonaws.com",
    });
    expect(payload.healthcheck).toEqual({
      enabled: true,
      mode: "http",
      url: "https://health.example.test/status",
    });
  });

  it("validates optional coordinate inputs", () => {
    expect(parseCoordinateInput("", "Latitude", -90, 90)).toBeNull();
    expect(parseCoordinateInput(" 48.8566 ", "Latitude", -90, 90)).toBe(
      48.8566,
    );
    expect(() => parseCoordinateInput("91", "Latitude", -90, 90)).toThrow(
      "Latitude must be a number between -90 and 90.",
    );
  });

  it("creates isolated default form state", () => {
    const first = createEmptyForm();
    const second = createEmptyForm();

    first.features.iam.enabled = false;

    expect(first.provider).toBe("ceph");
    expect(first.multisite_enabled).toBe(false);
    expect(first.verify_tls).toBe(true);
    expect(second.features.iam.enabled).toBe(true);
  });

  it("derives the multisite switch from persisted Ceph topology metadata", () => {
    const features = buildFeaturesPayload(defaultFeaturesForProvider("ceph"));
    const endpoint = {
      id: 1,
      name: "Ceph multisite",
      endpoint_url: "https://ceph.example.test",
      region: null,
      realm_id: "realm-a",
      zonegroup_id: "zonegroup-a",
      zone_id: "zone-a",
      force_path_style: false,
      latitude: null,
      longitude: null,
      verify_tls: true,
      provider: "ceph",
      admin_access_key: null,
      has_admin_secret: false,
      ceph_admin_active: false,
      service_identities: [],
      ceph_admin_allowed: false,
      capabilities: {},
      admin_ops_permissions: {
        users_read: false, users_write: false, buckets_read: false, buckets_write: false,
        accounts_read: false, accounts_write: false, usage_read: false, usage_write: false,
      },
      features,
      is_default: false,
      is_editable: true,
      tags: [],
      created_at: "2026-10-30T00:00:00Z",
      updated_at: "2026-10-30T00:00:00Z",
    } satisfies StorageEndpoint;

    expect(createFormFromEndpoint(endpoint).multisite_enabled).toBe(true);
    expect(createFormFromEndpoint({ ...endpoint, realm_id: null, zonegroup_id: null, zone_id: null }).multisite_enabled).toBe(false);
  });
});
