/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ManagerToolAccessSection } from "./AdminAccessSections";
import { buildManagerToolDefinitions, DEFAULT_MANAGER_TOOL_ACCESS } from "./adminAccessConfig";
import { DEFAULT_GENERAL_SETTINGS } from "../../components/GeneralSettingsContext";

const tools = buildManagerToolDefinitions({ ...DEFAULT_GENERAL_SETTINGS,
  manager_feature_policies: { ...DEFAULT_GENERAL_SETTINGS.manager_feature_policies, bucket_compare: "default_on" } }).slice(0, 1);

describe("additive Manager grants", () => {
  it("shows platform provenance while keeping a direct grant separate and editable", async () => {
    const change = vi.fn();
    render(<ManagerToolAccessSection title="Tools" description="Direct grants" tools={tools} onChange={change} />);
    expect(screen.getByText(/Grants are additive with platform and group grants/)).toBeVisible();
    expect(screen.getByText("Enabled")).toBeVisible();
    expect(screen.getByText("Platform")).toBeVisible();
    expect(screen.getByText("Direct grant")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Bucket compare: information" })).not.toBeInTheDocument();
    const grant = screen.getByRole("switch", { name: "Bucket compare" });
    expect(grant).not.toBeChecked();
    await userEvent.click(grant);
    expect(change).toHaveBeenCalledWith("bucket_compare", true);
  });

  it("never presents a platform grant as effective for an ineligible UI role", () => {
    render(<ManagerToolAccessSection title="Tools" description="Direct grants" tools={tools} eligible={false} onChange={vi.fn()} />);
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByText("Unavailable")).toBeVisible();
    expect(screen.getByText("Role required")).toBeVisible();
  });

  it("replaces a blocked direct grant switch with the saved grant state", () => {
    const blockedTools = [{ ...tools[0], enabled: false, platformDefault: false }];
    render(<ManagerToolAccessSection
      title="Tools"
      description="Direct grants"
      tools={blockedTools}
      access={{ ...DEFAULT_MANAGER_TOOL_ACCESS, bucket_compare: true }}
      onChange={vi.fn()}
    />);
    expect(screen.getByText("Unavailable")).toBeVisible();
    expect(screen.getByText("Platform disabled")).toBeVisible();
    expect(screen.getByText("Saved grant: On")).toBeVisible();
    expect(screen.queryByRole("switch", { name: "Bucket compare" })).not.toBeInTheDocument();
  });
});
