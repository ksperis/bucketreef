/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/openstack";
import OpenStackConnectionsPage from "./OpenStackConnectionsPage";

vi.mock("../../api/openstack");

const cloud = { id: 1, name: "Research", allow_password: true, allow_token: true, default_domain: "People", endpoints: [{ id: 2, name: "Region A", region: "A" }] };
const connection = { id: "connection", cloud_id: 1, cloud_name: "Research", display_name: "Person", keystone_user_id: "person-uuid", connected: true, expires_at: null };
function renderPage() { return render(<OpenStackConnectionsPage />); }

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listOpenStackClouds).mockResolvedValue([cloud]);
  vi.mocked(api.listOpenStackConnections).mockResolvedValue([]);
  vi.mocked(api.connectOpenStack).mockResolvedValue(connection);
});

describe("OpenStack connections", () => {
  it("keeps project selection in the workspace context selector", async () => {
    vi.mocked(api.listOpenStackConnections).mockResolvedValue([connection]);
    renderPage();

    expect(await screen.findByText("Research")).toBeInTheDocument();
    expect(screen.getByText("Connect your cloud identity. Its OpenStack projects then appear in the Manager and Browser context selector.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select…" })).not.toBeInTheDocument();
    expect(screen.queryByText("Project access")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Browser" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Manager" })).not.toBeInTheDocument();
    expect(api.listOpenStackProjects).not.toHaveBeenCalled();
    expect(api.getOpenStackProjectAccess).not.toHaveBeenCalled();
  });

  it("uses token authentication without collecting a cloud password", async () => {
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole("button", { name: "Connect cloud" }));
    await user.selectOptions(await screen.findByLabelText("Cloud"), "1");
    await user.selectOptions(screen.getByLabelText("Authentication"), "token");
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("User token"), "private-token");
    await user.click(screen.getByRole("button", { name: "Connect", exact: true }));
    await waitFor(() => expect(api.connectOpenStack).toHaveBeenCalledWith({ cloud_id: 1, method: "token", token: "private-token" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Connect OpenStack cloud" })).not.toBeInTheDocument());
  });

  it("opens reconnection in the shared profile dialog with the previous user identity", async () => {
    vi.mocked(api.listOpenStackConnections).mockResolvedValue([{ ...connection, connected: false }]);
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole("button", { name: "Reconnect" }));
    expect(screen.getByRole("dialog", { name: "Connect OpenStack cloud" })).toBeInTheDocument();
    expect(screen.getByLabelText("Cloud")).toHaveValue("1");
    expect(screen.getByLabelText("User name")).toHaveValue("person-uuid");
    expect(screen.getByRole("checkbox", { name: "Use user UUID" })).toBeChecked();
  });
});
