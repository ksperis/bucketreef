/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BillingAutomationSettingsPanel from "./BillingAutomationSettingsPanel";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  listRuns: vi.fn(),
}));

vi.mock("../../api/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/billing")>()),
  getBillingAutomationSettings: () => mocks.getSettings(),
  updateBillingAutomationSettings: (...args: unknown[]) => mocks.updateSettings(...args),
  listBillingAutomationRuns: () => mocks.listRuns(),
}));

describe("BillingAutomationSettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({
      mode: "automatic_draft",
      schedule_day: 5,
      require_all_subjects_assigned: true,
    });
    mocks.listRuns.mockResolvedValue([
      {
        id: 7,
        month: "2026-09",
        mode: "automatic_finalize",
        trigger_source: "scheduled",
        status: "partial",
        active_entity_count: 3,
        generated_statement_count: 3,
        finalized_statement_count: 2,
        blocked_statement_count: 1,
        failed_entity_count: 0,
        unassigned_subject_count: 1,
        diagnostics: [],
        started_at: "2026-10-05T02:00:00Z",
        completed_at: "2026-10-05T02:00:04Z",
      },
    ]);
  });

  it("shows the configured workflow, immutable safety gates, and recent run state", async () => {
    render(<BillingAutomationSettingsPanel />);

    expect(await screen.findByLabelText("Workflow")).toHaveValue("automatic_draft");
    expect(screen.getByLabelText("Run on day of month")).toHaveValue(5);
    expect(screen.getByText(/complete storage and usage coverage/)).toBeInTheDocument();
    expect(screen.getByText("2026-09")).toBeInTheDocument();
    expect(screen.getByText("partial")).toBeInTheDocument();
    expect(screen.getByText("3 generated · 2 finalized")).toBeInTheDocument();
    expect(screen.getByText("1 blocked · 0 failed · 1 unassigned")).toBeInTheDocument();
  });

  it("edits and saves automatic finalization policy in place", async () => {
    const saved = {
      mode: "automatic_finalize" as const,
      schedule_day: 8,
      require_all_subjects_assigned: false,
    };
    mocks.updateSettings.mockResolvedValue(saved);
    render(<BillingAutomationSettingsPanel />);

    const workflow = await screen.findByLabelText("Workflow");
    fireEvent.change(workflow, { target: { value: "automatic_finalize" } });
    fireEvent.change(screen.getByLabelText("Run on day of month"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Require every Billing subject/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledWith(saved));
    expect(await screen.findByText("Billing automation settings saved.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("disables scheduling controls in manual mode", async () => {
    mocks.getSettings.mockResolvedValue({
      mode: "manual",
      schedule_day: 5,
      require_all_subjects_assigned: true,
    });
    render(<BillingAutomationSettingsPanel />);

    expect(await screen.findByLabelText("Workflow")).toHaveValue("manual");
    expect(screen.getByLabelText("Run on day of month")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Require every Billing subject/ })).toBeDisabled();
  });
});
