import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("./client", () => ({
  default: clientMock,
  LONG_RUNNING_REQUEST_TIMEOUT_MS: 1234,
}));

import { downloadCostCsv, getCostAnalytics, getCostSubjects } from "./cost";

describe("admin cost api", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
    clientMock.get.mockResolvedValue({ data: {} });
  });

  it("uses the canonical subject_type query parameter", async () => {
    await getCostSubjects("2026-07", 7, "s3_user", 2, 50, "cost", "desc", "lab");
    await getCostAnalytics("2026-07", 7, "s3_user");
    await downloadCostCsv("2026-07", 7, "s3_user");

    expect(clientMock.get).toHaveBeenNthCalledWith(1, "/admin/cost/subjects", {
      params: {
        month: "2026-07",
        subject_type: "s3_user",
        page: 2,
        page_size: 50,
        sort_by: "cost",
        sort_dir: "desc",
        endpoint_id: 7,
        search: "lab",
      },
    });
    expect(clientMock.get).toHaveBeenNthCalledWith(2, "/admin/cost/analytics", {
      params: { month: "2026-07", subject_type: "s3_user", endpoint_id: 7 },
    });
    expect(clientMock.get).toHaveBeenNthCalledWith(3, "/admin/cost/export.csv", {
      params: { month: "2026-07", subject_type: "s3_user", endpoint_id: 7 },
      responseType: "blob",
      timeout: 1234,
    });
  });
});
