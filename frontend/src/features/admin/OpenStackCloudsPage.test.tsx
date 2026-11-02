/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenStackCloud } from "../../api/openstack";
import OpenStackCloudsPage from "./OpenStackCloudsPage";

const mocks = vi.hoisted(() => ({
  deleteCloud: vi.fn(),
  listClouds: vi.fn(),
  saveCloud: vi.fn(),
}));

vi.mock("../../api/openstack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/openstack")>()),
  deleteOpenStackCloud: (id: number) => mocks.deleteCloud(id),
  listAdminOpenStackClouds: () => mocks.listClouds(),
  saveOpenStackCloud: (payload: unknown, id?: number) => mocks.saveCloud(payload, id),
}));

vi.mock("../../auth/useRecentWebAuthnStepUp", () => ({
  useRecentWebAuthnStepUp: () => ({
    runWithStepUp: async (action: () => Promise<unknown>) => action(),
    verificationDialog: null,
  }),
}));

const cloud: OpenStackCloud = {
  id: 7,
  name: "Lab",
  auth_url: "https://keystone.example.net/v3",
  enabled: true,
  allow_password: true,
  allow_token: true,
  managed_endpoints_only: false,
  default_domain: "Default",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/openstack"]}>
      <OpenStackCloudsPage />
    </MemoryRouter>,
  );
}

describe("OpenStackCloudsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listClouds.mockResolvedValue([cloud]);
    mocks.deleteCloud.mockResolvedValue(undefined);
    mocks.saveCloud.mockResolvedValue(cloud);
  });

  it("loads the configured clouds eagerly and surfaces list errors", async () => {
    const { unmount } = renderPage();

    expect(await screen.findByText("Lab")).toBeInTheDocument();
    expect(screen.getByText("https://keystone.example.net/v3")).toBeInTheDocument();
    expect(mocks.listClouds).toHaveBeenCalledTimes(1);

    unmount();
    mocks.listClouds.mockRejectedValueOnce(new Error("cloud catalogue failed"));
    renderPage();

    expect(await screen.findAllByText("cloud catalogue failed")).toHaveLength(2);
  });

  it("refreshes the cloud catalogue after deletion", async () => {
    mocks.listClouds
      .mockResolvedValueOnce([cloud])
      .mockResolvedValueOnce([]);
    renderPage();
    await screen.findByText("Lab");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mocks.deleteCloud).toHaveBeenCalledWith(7));
    await waitFor(() => expect(mocks.listClouds).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Lab")).not.toBeInTheDocument();
    expect(screen.getByText("No OpenStack cloud is available for your account.")).toBeInTheDocument();
  });

  it("tracks editor dirtiness against the shared draft baseline", async () => {
    renderPage();
    await screen.findByText("Lab");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const name = screen.getByRole("textbox", { name: "Name" });
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    fireEvent.change(name, { target: { value: "Lab updated" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    fireEvent.change(name, { target: { value: "Lab" } });
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});
