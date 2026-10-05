import { describe, expect, it } from "vitest";
import { readModels } from "./readModels";
import { createSeed } from "./state";
import { currentUser, type DemoRequest } from "./http";

function fixture() {
  const state = createSeed();
  const get = async (suffix: string) => {
    const path = `/admin/stats/dashboard/${suffix}`;
    const c: DemoRequest = { state, path, method: "GET", body: {}, url: new URL(`https://demo.test/api${path}`), request: new Request("https://demo.test"), persona: "admin", user: currentUser(state, "admin") };
    const response = readModels(c);
    expect(response).toBeDefined();
    return response!.json();
  };
  return { state, get };
}

describe("demo supervised dashboard metrics", () => {
  it("serves aggregate metrics and a 24-hour traffic window for both Ceph endpoints", async () => {
    const { state, get } = fixture();
    expect((await get("scope")).endpoints).toHaveLength(2);
    const storage = await get("storage");
    expect(storage.coverage.complete_count).toBe(2);
    expect(storage.cache).toEqual({ hit: true, expires_at: new Date(Date.parse(state.initializedAt) + 1800000).toISOString() });
    expect(storage.storage_totals.bucket_count).toBe(state.buckets.length);
    const traffic = await get("traffic");
    expect(traffic.window).toBe("day");
    expect(traffic.cache).toEqual(storage.cache);
    expect(Date.parse(traffic.end) - Date.parse(traffic.start)).toBe(86400000);
    expect(traffic.totals.ops).toBeGreaterThan(0);
    expect(traffic.coverage.eligible_count).toBe(2);
  });

  it("uses separate eligible groups and excludes endpoints with supervision errors", async () => {
    const { state, get } = fixture();
    const originalOps = (await get("traffic")).totals.ops;
    state.endpoints[0].capabilities!.metrics = false;
    expect((await get("storage")).coverage.eligible_count).toBe(1);
    expect((await get("traffic")).coverage.eligible_count).toBe(2);
    state.endpoints[1].service_identities!.find(identity => identity.kind === "supervision")!.status = "error";
    expect((await get("scope")).endpoints).toHaveLength(1);
    expect((await get("storage")).storage_totals.used_bytes).toBeNull();
    expect((await get("traffic")).totals.ops).toBeLessThan(originalOps);
  });

  it("represents an empty supervised scope with unavailable measurements", async () => {
    const { state, get } = fixture();
    state.endpoints.forEach(endpoint => { endpoint.service_identities = []; });
    expect((await get("scope")).endpoints).toEqual([]);
    expect((await get("storage")).storage_totals.bucket_count).toBeNull();
    const traffic = await get("traffic");
    expect(traffic.totals.ops).toBeNull();
    expect(traffic.series).toEqual([]);
  });
});
