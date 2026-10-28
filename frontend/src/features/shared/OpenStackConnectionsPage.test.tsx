/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/openstack";
import { ApiError } from "../../api/client";
import OpenStackConnectionsPage from "./OpenStackConnectionsPage";

vi.mock("../../api/openstack");
vi.mock("../../components/GeneralSettingsContext", () => ({ useGeneralSettings: () => ({
  runtimeSurfaces: { browser: true, manager: true },
  generalSettings: { browser_enabled: true, browser_root_enabled: true, manager_enabled: true },
}) }));

const cloud = { id: 1, name: "Research", allow_password: true, allow_token: true, default_domain: "People", endpoints: [{ id: 2, name: "Region A", region: "A" }] };
const connection = { id: "connection", cloud_id: 1, cloud_name: "Research", display_name: "Person", keystone_user_id: "person-uuid", connected: true, expires_at: null };
function Location() { return <output>{useLocation().pathname + useLocation().search}</output>; }
function renderPage() { return render(<MemoryRouter><OpenStackConnectionsPage /><Location /></MemoryRouter>); }

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listOpenStackClouds).mockResolvedValue([cloud]);
  vi.mocked(api.listOpenStackConnections).mockResolvedValue([]);
  vi.mocked(api.connectOpenStack).mockResolvedValue(connection);
  vi.mocked(api.listOpenStackProjects).mockResolvedValue([{ id: "project", name: "Project", domain_id: "domain" }]);
  vi.mocked(api.listOpenStackKeys).mockResolvedValue(["first", "second"]);
  vi.mocked(api.activateOpenStackContext).mockResolvedValue("os-context");
});

describe("OpenStack project connection", () => {
  it.each(["Manager", "Browser"] as const)("requires an explicit key choice and opens the selected %s context", async (workspace) => {
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole("button", { name: "Connect cloud" }));
    expect(screen.getByRole("dialog", { name: "Connect OpenStack cloud" })).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText("Cloud"), "1");
    await user.type(screen.getByLabelText("User name"), "person");
    await user.type(screen.getByLabelText("Password"), "private-password");
    await user.click(screen.getByRole("button", { name: "Connect", exact: true }));
    const keys = await screen.findByLabelText("EC2 access key");
    expect(screen.getByRole("button", { name: `Open ${workspace}` })).toBeDisabled();
    expect(screen.queryByRole("dialog", { name: "Connect OpenStack cloud" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByText("private-password")).not.toBeInTheDocument();
    await user.selectOptions(keys, "second");
    await user.click(screen.getByRole("button", { name: `Open ${workspace}` }));
    await waitFor(() => expect(api.activateOpenStackContext).toHaveBeenCalledWith("connection", "project", 2, "second"));
    expect(await screen.findByText(`/${workspace.toLowerCase()}?ctx=os-context`)).toBeInTheDocument();
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

  it("handles missing EC2 credentials without offering to create keys", async () => {
    vi.mocked(api.listOpenStackConnections).mockResolvedValue([connection]);
    vi.mocked(api.listOpenStackKeys).mockResolvedValue([]);
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole("button", { name: "Select…" }));
    expect(await screen.findByText("No EC2 key for this project. Provision one in OpenStack, then retry.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Browser" })).toBeDisabled();
    expect(api.activateOpenStackContext).not.toHaveBeenCalled();
  });

  it.each([
    ["reauthentication_required", "Reconnect to OpenStack to continue."],
    ["access_denied", "Keystone denied this operation."],
    ["provider_unavailable", "The cloud is unavailable. Retry later."],
  ])("presents the %s provider state", async (code, message) => {
    vi.mocked(api.listOpenStackConnections).mockResolvedValue([connection]);
    vi.mocked(api.listOpenStackProjects).mockRejectedValue(new ApiError("Provider failure", {
      response: { status: 409, data: { detail: { code, message: "Server fallback" } }, headers: {} },
    }));
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole("button", { name: "Select…" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Browser" })).toBeDisabled();
  });
});
