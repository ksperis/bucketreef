/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/openstack";
import { setSessionUserCache } from "../../utils/workspaces";
import OpenStackConnectionsPage from "./OpenStackConnectionsPage";

vi.mock("../../api/openstack");

const cloud = { id: 1, name: "Research", allow_password: true, allow_token: true, default_domain: "People", endpoints: [{ id: 2, name: "Region A", region: "A" }] };
const connection = { id: "connection", cloud_id: 1, cloud_name: "Research", display_name: "Person", keystone_user_id: "person-uuid", connected: true, expires_at: null };
const project = { project_id: "project-a", project_name: "Project A", project_domain_id: "domain-a" };
const projectAccess = {
  targets: [{
    target_id: "catalog-s3-region-a",
    region_id: "region-a",
    interface: "public" as const,
    service_type: "s3",
    service_name: "S3",
    endpoint_url: "https://s3.example.test",
    storage_endpoint_id: null,
    storage_endpoint_name: null,
    allowed: true,
  }],
  access_keys: ["EC2-ACCESS"],
};
function renderPage() { return render(<OpenStackConnectionsPage />); }

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listOpenStackClouds).mockResolvedValue([cloud]);
  vi.mocked(api.listOpenStackConnections).mockResolvedValue([]);
  vi.mocked(api.connectOpenStack).mockResolvedValue(connection);
  vi.mocked(api.listOpenStackProjects).mockResolvedValue([]);
  vi.mocked(api.getOpenStackProjectAccess).mockResolvedValue(projectAccess);
  vi.mocked(api.createOpenStackPrivateConnection).mockResolvedValue({ id: 99, name: "Project A" } as never);
  setSessionUserCache({
    role: "ui_user",
    authType: "password",
    effective_access: { can_create_manual_private_connections: true } as never,
  });
});

afterEach(() => setSessionUserCache(null));

describe("OpenStack connections", () => {
  it("loads all projects only after selecting a connected identity", async () => {
    vi.mocked(api.listOpenStackConnections).mockResolvedValue([connection]);
    vi.mocked(api.listOpenStackProjects).mockResolvedValue([project]);
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("Research")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toHaveClass("text-right");
    expect(screen.getByText("Connect your cloud identity. Its OpenStack projects then appear in the Manager and Browser context selector.")).toBeInTheDocument();
    expect(api.listOpenStackProjects).not.toHaveBeenCalled();
    expect(api.getOpenStackProjectAccess).not.toHaveBeenCalled();

    await user.click(screen.getByText("Research"));
    expect(await screen.findByText("Project A")).toBeInTheDocument();
    expect(api.listOpenStackProjects).toHaveBeenCalledWith("connection");
    expect(api.getOpenStackProjectAccess).not.toHaveBeenCalled();
  });

  it("paginates and searches large project lists with the shared list controls", async () => {
    vi.mocked(api.listOpenStackConnections).mockResolvedValue([connection]);
    vi.mocked(api.listOpenStackProjects).mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => ({
        project_id: `project-${String(index + 1).padStart(2, "0")}`,
        project_name: `Project ${String(index + 1).padStart(2, "0")}`,
        project_domain_id: index === 29 ? "research-domain" : "default-domain",
      })),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Projects" }));
    expect(await screen.findByText("Project 01")).toBeInTheDocument();
    expect(screen.getByText("Project 25")).toBeInTheDocument();
    expect(screen.queryByText("Project 26")).not.toBeInTheDocument();
    expect(screen.getByText("30 projects shown")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Project 26")).toBeInTheDocument();
    expect(screen.getByText("Project 30")).toBeInTheDocument();
    expect(screen.queryByText("Project 01")).not.toBeInTheDocument();

    const search = screen.getByRole("searchbox", { name: "Search projects" });
    await user.clear(search);
    await user.type(search, "research-domain");
    expect(await screen.findByText("Project 30")).toBeInTheDocument();
    expect(screen.queryByText("Project 29")).not.toBeInTheDocument();
    expect(screen.getByText("1 projects shown of 30")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "missing-project");
    expect(await screen.findByText("No OpenStack project matches this search.")).toBeInTheDocument();
  });

  it("imports an existing project credential without exposing a secret field", async () => {
    vi.mocked(api.listOpenStackConnections).mockResolvedValue([connection]);
    vi.mocked(api.listOpenStackProjects).mockResolvedValue([project]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Projects" }));
    await user.click(await screen.findByRole("button", { name: "Add private S3 connection" }));
    const dialog = await screen.findByRole("dialog", { name: "Add private S3 connection" });
    await waitFor(() => expect(api.getOpenStackProjectAccess).toHaveBeenCalledWith("connection", "project-a"));
    expect(within(dialog).queryByLabelText(/secret/i)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Region")).toHaveValue("catalog-s3-region-a");
    expect(within(dialog).getByLabelText("EC2 access key")).toHaveValue("EC2-ACCESS");

    await user.click(within(dialog).getByRole("button", { name: "Add private S3 connection" }));
    await waitFor(() => expect(api.createOpenStackPrivateConnection).toHaveBeenCalledWith(
      "connection",
      "project-a",
      {
        connection_name: "Project A",
        target_id: "catalog-s3-region-a",
        access_key: "EC2-ACCESS",
        access_manager: false,
        access_browser: true,
      },
    ));
  });

  it("requires an explicit region choice when several S3 regions are available", async () => {
    vi.mocked(api.listOpenStackConnections).mockResolvedValue([connection]);
    vi.mocked(api.listOpenStackProjects).mockResolvedValue([project]);
    vi.mocked(api.getOpenStackProjectAccess).mockResolvedValue({
      ...projectAccess,
      targets: [
        projectAccess.targets[0],
        {
          ...projectAccess.targets[0],
          target_id: "catalog-s3-region-b",
          region_id: "region-b",
          endpoint_url: "https://s3-b.example.test",
        },
      ],
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Projects" }));
    await user.click(await screen.findByRole("button", { name: "Add private S3 connection" }));
    const dialog = await screen.findByRole("dialog", { name: "Add private S3 connection" });
    const region = within(dialog).getByLabelText("Region");
    await waitFor(() => expect(region).toHaveValue(""));
    expect(within(dialog).getByRole("button", { name: "Add private S3 connection" })).toBeDisabled();

    await user.selectOptions(region, "catalog-s3-region-b");
    expect(within(dialog).getByRole("button", { name: "Add private S3 connection" })).toBeEnabled();
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
