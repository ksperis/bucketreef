/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ManagerToolAccessSection } from "./AdminAccessSections";
import { buildManagerToolDefinitions } from "./adminAccessConfig";
import { DEFAULT_GENERAL_SETTINGS } from "../../components/GeneralSettingsContext";

const tools = buildManagerToolDefinitions({ ...DEFAULT_GENERAL_SETTINGS,
  manager_feature_policies: { ...DEFAULT_GENERAL_SETTINGS.manager_feature_policies, bucket_compare: "default_on" } }).slice(0, 1);

describe("additive Manager grants", () => {
  it("shows platform provenance while keeping a direct grant separate and editable", async () => {
    const change = vi.fn();
    render(<ManagerToolAccessSection title="Tools" description="Direct grants" tools={tools} onChange={change} />);
    expect(screen.getByText("Enabled by platform")).toBeVisible();
    const grant = screen.getByRole("switch", { name: "Bucket compare" });
    expect(grant).not.toBeChecked();
    await userEvent.click(grant);
    expect(change).toHaveBeenCalledWith("bucket_compare", true);
  });

  it("never presents a platform grant as effective for an ineligible UI role", () => {
    render(<ManagerToolAccessSection title="Tools" description="Direct grants" tools={tools} eligible={false} onChange={vi.fn()} />);
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.queryByText("Enabled by platform")).not.toBeInTheDocument();
  });
});
