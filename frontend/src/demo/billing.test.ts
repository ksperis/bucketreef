import { describe, expect, it } from "vitest";

import { currentUser, type DemoRequest } from "./http";
import { readModels } from "./readModels";
import { createSeed } from "./state";

async function getBilling(path: string) {
  const state = createSeed();
  const url = new URL(`https://demo.test/api${path}`);
  const request: DemoRequest = {
    state,
    path: url.pathname.slice(4),
    method: "GET",
    body: {},
    url,
    request: new Request(url),
    persona: "admin",
    user: currentUser(state, "admin"),
  };
  const response = readModels(request);
  expect(response).toBeDefined();
  return response!.json();
}

describe("demo Billing read models", () => {
  it("serves the current pricing-resolution contract for summaries, subjects, and details", async () => {
    const summary = await getBilling("/admin/billing/summary?month=2026-10&endpoint_id=11");
    expect(summary.rate_resolution).toMatchObject({
      status: "resolved",
      layer: "endpoint",
      rate_plan_name: "Demo Ceph internal rates",
      storage_charge_basis: "actual_usage",
    });
    expect(summary.cost.storage_quantity).toMatchObject({ basis: "actual_usage", status: "partial" });

    const subjects = await getBilling("/admin/billing/subjects?month=2026-10&endpoint_id=11&subject_type=account");
    expect(subjects.items.length).toBeGreaterThan(0);
    expect(subjects.items[0].rate_resolution.status).toBe("resolved");

    const detail = await getBilling("/admin/billing/subject/account/101?month=2026-10&endpoint_id=11");
    expect(detail.rate_resolution.status).toBe("resolved");
    expect(detail.daily).toHaveLength(30);
  });

  it("covers the analytical, statement, and settings reads used by the Admin workflow", async () => {
    const analysis = await getBilling("/admin/billing/analysis?month=2026-10");
    expect(analysis.entities).toHaveLength(2);
    expect(analysis.groups).toHaveLength(1);
    expect(analysis.entities[0].complete).toBe(true);

    const entityStatements = await getBilling(
      "/admin/billing/statements?month=2026-10&billing_entity_id=31",
    );
    expect(entityStatements).toHaveLength(1);
    expect(entityStatements[0]).toMatchObject({ billing_entity_id: 31, status: "finalized" });
    expect(entityStatements[0].lines.length).toBeGreaterThan(0);

    expect(await getBilling("/admin/billing/rate-cards")).toHaveLength(2);
    expect(await getBilling("/admin/billing/entities")).toHaveLength(2);
    expect(await getBilling("/admin/billing/groups")).toHaveLength(1);
    expect(await getBilling("/admin/billing/automation/settings")).toMatchObject({ mode: "manual" });
    expect(await getBilling("/admin/billing/pdf/settings")).toMatchObject({ organization_name: "BucketReef" });
  });
});
