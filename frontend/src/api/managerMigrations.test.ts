import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  put: vi.fn(),
}));

vi.mock("./client", () => ({ default: clientMock }));

import { updateManagerMigration } from "./managerMigrations";

describe("manager migrations api", () => {
  beforeEach(() => {
    clientMock.put.mockReset();
    clientMock.put.mockResolvedValue({ data: { id: 7 } });
  });

  it("replaces a draft migration definition with PUT", async () => {
    const payload = {
      source_context_id: "10",
      target_context_id: "20",
      buckets: [{ source_bucket: "source", target_bucket: "target" }],
      configuration_revision: 3,
    };

    await updateManagerMigration(7, payload);

    expect(clientMock.put).toHaveBeenCalledWith("/manager/migrations/7", payload);
  });
});
