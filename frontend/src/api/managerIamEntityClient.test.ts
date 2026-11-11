import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("./client", () => ({
  default: clientMock,
}));

import {
  buildIamRequestConfig,
  listIamEntityPage,
} from "./managerIamEntityClient";

describe("manager IAM entity client", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
    clientMock.get.mockResolvedValue({ data: { items: [], next_marker: null } });
  });

  it("builds request parameters with the selected execution context", () => {
    expect(buildIamRequestConfig("acc-7", { feature: "details" })).toEqual({
      params: { feature: "details", context_id: "acc-7" },
    });
  });

  it("normalizes cursor query parameters through the shared request config", async () => {
    await listIamEntityPage("users", "acc-7", {
      marker: "next-user",
      page_size: 25,
      search: "  alice  ",
      include_details: true,
    });

    expect(clientMock.get).toHaveBeenCalledWith("/manager/iam/users/page", {
      params: {
        marker: "next-user",
        page_size: 25,
        search: "alice",
        include_details: true,
        context_id: "acc-7",
      },
    });
  });
});
