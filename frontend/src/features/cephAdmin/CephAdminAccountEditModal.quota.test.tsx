/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CephAdminAccountEditModal from "./CephAdminAccountEditModal";

const getDetail = vi.fn();
const updateConfig = vi.fn();
vi.mock("../../api/cephAdminAccounts", () => ({
  getCephAdminAccountDetail: (...args: unknown[]) => getDetail(...args),
  updateCephAdminAccountConfig: (...args: unknown[]) => updateConfig(...args),
}));

const detail = {
  account_id: "RGW12345678901234567", account_name: "Analytics", email: "analytics@example.com",
  quota: { enabled: true, max_size_bytes: 1073741825, max_objects: 25 },
  bucket_quota: { enabled: true, max_size_bytes: 1537, max_objects: 10 },
};

async function openConfiguration(onClose = vi.fn()) {
  render(<CephAdminAccountEditModal endpointId={7} accountId={detail.account_id} canViewMetrics={false} onClose={onClose} />);
  await screen.findByText("analytics@example.com");
  fireEvent.click(screen.getByRole("tab", { name: "Configuration" }));
  return {
    account: within(screen.getByRole("region", { name: "Account quota" })),
    bucket: within(screen.getByRole("region", { name: "Bucket quota" })),
  };
}

async function saveConfiguration() {
  fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
  await waitFor(() => expect(updateConfig).toHaveBeenCalledOnce());
  expect(updateConfig.mock.calls[0].slice(0, 2)).toEqual([7, detail.account_id]);
  return updateConfig.mock.calls[0][2];
}

describe("RGW account configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDetail.mockResolvedValue(detail);
    updateConfig.mockResolvedValue(detail);
  });

  it("displays both quotas exactly and omits them from an unrelated profile save", async () => {
    const { account, bucket } = await openConfiguration();
    expect(account.getByLabelText("Storage quota")).toHaveValue(1073741825);
    expect(bucket.getByLabelText("Storage quota")).toHaveValue(1537);
    for (const quota of [account, bucket]) expect(quota.getByLabelText("Unit")).toHaveValue("B");
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Analytics Ops" } });
    const payload = await saveConfiguration();
    expect(payload.account_name).toBe("Analytics Ops");
    expect(Object.keys(payload).filter((key) => key.includes("quota"))).toEqual([]);
  });

  it("keeps zero limits distinct from empty fields in both quota forms", async () => {
    getDetail.mockResolvedValueOnce({ ...detail,
      quota: { enabled: true, max_size_bytes: 0, max_objects: 0 },
      bucket_quota: { enabled: true, max_size_bytes: 0, max_objects: 0 },
    });
    const { account, bucket } = await openConfiguration();
    for (const quota of [account, bucket]) {
      expect(quota.getByLabelText("Storage quota")).toHaveValue(0);
      expect(quota.getByLabelText("Object quota")).toHaveValue(0);
    }
    expect(Object.keys(await saveConfiguration()).filter((key) => key.includes("quota"))).toEqual([]);
  });

  it.each(["account", "bucket"] as const)("disables only the %s quota without clearing either limit", async (kind) => {
    const forms = await openConfiguration();
    fireEvent.click(forms[kind].getByLabelText(`Enable ${kind} quota`));
    expect(forms[kind].getByLabelText("Storage quota")).toBeDisabled();
    const payload = await saveConfiguration();
    const enabledKey = kind === "account" ? "quota_enabled" : "bucket_quota_enabled";
    expect(Object.keys(payload).filter((key) => key.includes("quota"))).toEqual([enabledKey]);
    expect(payload[enabledKey]).toBe(false);
  });

  it.each(["account", "bucket"] as const)("changes only the %s quota using exact bytes", async (kind) => {
    const forms = await openConfiguration();
    fireEvent.change(forms[kind].getByLabelText("Storage quota"), { target: { value: "2621441" } });
    const payload = await saveConfiguration();
    const sizeKey = kind === "account" ? "quota_max_size_bytes" : "bucket_quota_max_size_bytes";
    expect(Object.keys(payload).filter((key) => key.includes("quota"))).toEqual([sizeKey]);
    expect(payload[sizeKey]).toBe(2621441);
  });

  it("retains explicit clearing of an enabled quota", async () => {
    const { bucket } = await openConfiguration();
    fireEvent.change(bucket.getByLabelText("Storage quota"), { target: { value: "" } });
    fireEvent.change(bucket.getByLabelText("Object quota"), { target: { value: "" } });
    const payload = await saveConfiguration();
    expect(payload).toMatchObject({ bucket_quota_max_size_bytes: null, bucket_quota_max_objects: null });
    expect(Object.keys(payload).filter((key) => key.startsWith("quota_"))).toEqual([]);
  });

  it("validates limits next to their fields and preserves explicit profile clearing", async () => {
    const { account, bucket } = await openConfiguration();
    const form = screen.getByRole("form", { name: "RGW account configuration" });
    fireEvent.change(screen.getByLabelText("Max users"), { target: { value: "1.5" } });
    fireEvent.change(account.getByLabelText("Storage quota"), { target: { value: "-1" } });
    fireEvent.change(bucket.getByLabelText("Object quota"), { target: { value: "-1" } });
    fireEvent.submit(form);
    expect(updateConfig).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Max users")).toHaveFocus());
    for (const field of [screen.getByLabelText("Max users"), account.getByLabelText("Storage quota"), bucket.getByLabelText("Object quota")]) {
      expect(field).toHaveAttribute("aria-invalid", "true");
      fireEvent.change(field, { target: { value: "" } });
      expect(field).not.toHaveAttribute("aria-invalid", "true");
    }
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "" } });
    fireEvent.submit(form);
    await waitFor(() => expect(updateConfig).toHaveBeenCalledOnce());
    expect(updateConfig.mock.calls[0][2]).toMatchObject({ account_name: null, email: null, max_users: null, quota_max_size_bytes: null, bucket_quota_max_objects: null });
  });

  it("freezes pending fields and retains the exact payload for retry", async () => {
    let rejectRequest!: (error: Error) => void;
    updateConfig.mockReturnValueOnce(new Promise((_, reject) => { rejectRequest = reject; }));
    const onClose = vi.fn();
    await openConfiguration(onClose);
    const form = screen.getByRole("form", { name: "RGW account configuration" });
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Analytics Ops" } });
    fireEvent.submit(form);
    for (const field of form.querySelectorAll("input,select")) expect(field).toBeDisabled();
    fireEvent.submit(form);
    fireEvent.click(screen.getByRole("button", { name: "Back to accounts" }));
    expect(updateConfig).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => rejectRequest(new Error("Account update refused")));
    expect(await screen.findByText("Account update refused")).toBeInTheDocument();
    expect(screen.getByLabelText("Account name")).toHaveValue("Analytics Ops");
    fireEvent.submit(form);
    await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(2));
    expect(updateConfig.mock.calls[1]).toEqual(updateConfig.mock.calls[0]);
  });

  it("requires loaded account details before enabling configuration", async () => {
    getDetail.mockRejectedValueOnce(new Error("Unable to read account"));
    render(<CephAdminAccountEditModal endpointId={7} accountId={detail.account_id} canViewMetrics={false} onClose={vi.fn()} />);
    await screen.findByText("Unable to read account");
    fireEvent.click(screen.getByRole("tab", { name: "Configuration" }));
    expect(screen.getByText("Unable to read account")).toBeInTheDocument();
    expect(screen.getByLabelText("Account name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save configuration" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "RGW account configuration" }));
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
