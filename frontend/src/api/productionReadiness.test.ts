import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("./client", () => ({ default: clientMock }));

import { fetchProductionReadiness } from "./productionReadiness";

describe("production readiness API", () => {
  beforeEach(() => clientMock.get.mockReset());

  it("loads the current backend readiness report", async () => {
    const payload = {
      environment: "production",
      profile: "admin",
      status: "pass",
      counts: { pass: 3, warning: 0, fail: 0 },
      findings: [],
    };
    const controller = new AbortController();
    clientMock.get.mockResolvedValue({ data: payload });

    await expect(fetchProductionReadiness(controller.signal)).resolves.toEqual(payload);
    expect(clientMock.get).toHaveBeenCalledWith("/admin/production-readiness", { signal: controller.signal });
  });
});
