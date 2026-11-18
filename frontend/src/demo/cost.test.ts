import { describe, expect, it } from "vitest";
import { currentUser, DemoError, type DemoRequest } from "./http";
import { readModels } from "./readModels";
import { createSeed } from "./state";

function request(state: ReturnType<typeof createSeed>, path: string, query = ""): DemoRequest {
  const url = new URL(`https://demo.test/api${path}${query}`);
  return {
    state,
    url,
    path,
    method: "GET",
    body: {},
    request: new Request(url),
    persona: "admin",
    user: currentUser(state, "admin"),
  };
}

describe("demo Cost contract", () => {
  it("keeps subject rows scoped to their real storage endpoint", async () => {
    const state = createSeed();
    const allResponse = readModels(request(state, "/admin/cost/subjects", "?month=2026-11&page_size=25"));
    expect(allResponse).toBeDefined();
    const allSubjects = await allResponse!.json();
    const account104 = allSubjects.items.find((item: { subject_id: number }) => item.subject_id === 104);

    expect(account104).toMatchObject({
      storage_endpoint_id: 12,
      storage_endpoint_name: "Lyon · Archive",
      subject_type: "account",
      subject_id: 104,
    });

    const parisResponse = readModels(request(
      state,
      "/admin/cost/subjects",
      "?month=2026-11&endpoint_id=11&page_size=25",
    ));
    expect(parisResponse).toBeDefined();
    const parisSubjects = await parisResponse!.json();

    expect(parisSubjects.items.every((item: { storage_endpoint_id: number }) => item.storage_endpoint_id === 11)).toBe(true);
    expect(parisSubjects.items.some((item: { subject_id: number }) => item.subject_id === 104)).toBe(false);
  });

  it("returns the Admin detail history required by the Cost detail page", async () => {
    const state = createSeed();
    const response = readModels(request(
      state,
      "/admin/cost/subject/account/104",
      "?month=2026-11&endpoint_id=12",
    ));
    expect(response).toBeDefined();
    const detail = await response!.json();

    expect(detail).toMatchObject({
      month: "2026-11",
      storage_endpoint_id: 12,
      storage_endpoint_name: "Lyon · Archive",
      subject_type: "account",
      subject_id: 104,
    });
    expect(detail.history).toHaveLength(12);
    expect(detail.history.at(-1)).toMatchObject({
      month: "2026-11",
      cost: detail.cost,
    });
  });

  it("rejects a subject detail requested through another endpoint", () => {
    const state = createSeed();

    expect(() => readModels(request(
      state,
      "/admin/cost/subject/account/104",
      "?month=2026-11&endpoint_id=11",
    ))).toThrowError(DemoError);
  });
});
