/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BrowserAccessSection, ManagerToolAccessSection } from "./AdminAccessSections";
import { LanguageProvider, useLanguage } from "../../components/language";
import {
  buildManagerToolDefinitions,
  DEFAULT_MANAGER_TOOL_ACCESS,
  roleSupportsOperationalAccess,
} from "./adminAccessConfig";
import { DEFAULT_GENERAL_SETTINGS } from "../../components/GeneralSettingsContext";


function FrenchLanguageButton() {
  const { setLanguage } = useLanguage();
  return <button onClick={() => setLanguage("fr")}>fr</button>;
}

const tools = buildManagerToolDefinitions({ ...DEFAULT_GENERAL_SETTINGS,
  manager_feature_policies: { ...DEFAULT_GENERAL_SETTINGS.manager_feature_policies, bucket_compare: "default_on" } }).slice(0, 1);

describe("UI role operational access", () => {
  it.each([
    ["ui_superadmin", true],
    ["ui_admin", true],
    ["ui_user", true],
    ["ui_none", false],
  ] as const)("maps %s to %s", (role, expected) => {
    expect(roleSupportsOperationalAccess(role)).toBe(expected);
  });
});

describe("access section localization", () => {
  it("localizes Manager provenance and Browser technical tools", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <FrenchLanguageButton />
        <ManagerToolAccessSection title="Manager" description="Autorisations Manager." tools={tools} onChange={vi.fn()} />
        <BrowserAccessSection checked={false} onChange={vi.fn()} />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: "fr" }));

    expect(await screen.findByText(/Les autorisations sont cumulatives avec celles de la plateforme/)).toBeVisible();
    expect(screen.getByText("Comparaison de buckets")).toBeVisible();
    expect(screen.getByText("Activé")).toBeVisible();
    expect(screen.getByText("Plateforme")).toBeVisible();
    expect(screen.getByText("Autorisation directe")).toBeVisible();
    expect(screen.getByText("Outils S3 techniques")).toBeVisible();
    expect(screen.getByRole("switch", { name: "Activer les outils S3 techniques" })).toBeInTheDocument();
    expect(screen.queryByText("Technical S3 tools")).not.toBeInTheDocument();
  });
});

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

  it("keeps a blocked direct grant visible and allows it to be revoked", async () => {
    const change = vi.fn();
    const blockedTools = [{ ...tools[0], enabled: false, platformDefault: false }];
    render(<ManagerToolAccessSection
      title="Tools"
      description="Direct grants"
      tools={blockedTools}
      access={{ ...DEFAULT_MANAGER_TOOL_ACCESS, bucket_compare: true }}
      onChange={change}
    />);
    expect(screen.getByText("Unavailable")).toBeVisible();
    expect(screen.getByText("Platform")).toBeVisible();
    expect(screen.queryByText("Platform disabled")).not.toBeInTheDocument();
    expect(screen.queryByText("Saved grant: On")).not.toBeInTheDocument();
    const grant = screen.getByRole("switch", { name: "Bucket compare" });
    expect(grant).toBeChecked();
    expect(grant).not.toBeDisabled();
    await userEvent.click(grant);
    expect(change).toHaveBeenCalledWith("bucket_compare", false);
  });

  it("keeps a blocked grant disabled when there is nothing to revoke", () => {
    const blockedTools = [{ ...tools[0], enabled: false, platformDefault: false }];
    render(<ManagerToolAccessSection
      title="Tools"
      description="Direct grants"
      tools={blockedTools}
      onChange={vi.fn()}
    />);
    const grant = screen.getByRole("switch", { name: "Bucket compare" });
    expect(grant).not.toBeChecked();
    expect(grant).toBeDisabled();
  });
});
