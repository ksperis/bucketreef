import { describe, expect, it } from "vitest";

import { buildAdminNav } from "./features/admin/AdminLayout";

function getSettingsLink(label: string, options: Parameters<typeof buildAdminNav>) {
  const settingsSection = buildAdminNav(...options).find((section) => section.label === "Settings");
  return settingsSection?.links.find((link) => link.label === label);
}

function getAuditReportingLink(label: string, options: Parameters<typeof buildAdminNav>) {
  const auditReportingSection = buildAdminNav(...options).find((section) => section.label === "Audit & Reporting");
  return auditReportingSection?.links.find((link) => link.label === label);
}

describe("buildAdminNav", () => {
  it("exposes Production readiness in Settings only to superadmins", () => {
    const superadminNav = buildAdminNav(true, true, false, false, false, true);
    const adminNav = buildAdminNav(true, true, false, false, false, false);
    const productionReadinessLink = superadminNav
      .find((section) => section.label === "Settings")
      ?.links.find((link) => link.label === "Production readiness");

    expect(productionReadinessLink?.to).toBe("/admin/production-readiness");
    expect(
      superadminNav
        .find((section) => section.label == null)
        ?.links.find((link) => link.label === "Production readiness"),
    ).toBeUndefined();
    expect(adminNav.find((section) => section.label === "Settings")).toBeUndefined();
  });

  it("sets explicit hint for disabled Browser settings link", () => {
    const browserLink = getSettingsLink("Browser", [true, false, false, false, false, true]);

    expect(browserLink?.disabled).toBe(true);
    expect(browserLink?.disabledHint).toBe("Browser feature is disabled in General settings.");
  });

  it("does not set hint when Browser settings link is enabled", () => {
    const browserLink = getSettingsLink("Browser", [true, true, true, false, false, true]);

    expect(browserLink?.disabled).toBe(false);
    expect(browserLink?.disabledHint).toBeUndefined();
  });

  it("sets explicit hint for disabled Portal settings link", () => {
    const portalLink = getSettingsLink("Portal", [false, true, false, false, false, true]);

    expect(portalLink?.disabled).toBe(true);
    expect(portalLink?.disabledHint).toBe("Portal feature is disabled in General settings.");
  });

  it("disables Cost settings when the Cost feature is inactive", () => {
    const costLink = getSettingsLink("Cost", [true, true, false, false, false, true]);

    expect(costLink?.disabled).toBe(true);
    expect(costLink?.disabledHint).toBe("Cost feature is disabled in General settings.");
    expect(costLink?.to).toBe("/admin/cost-settings");
    expect(costLink?.iconName).toBe("cost");
  });

  it("enables Cost settings when the Cost feature is active", () => {
    const costLink = getSettingsLink("Cost", [true, true, true, false, false, true]);

    expect(costLink?.disabled).toBe(false);
    expect(costLink?.disabledHint).toBeUndefined();
  });

  it("uses the same dedicated Cost icon for reporting and Cost settings", () => {
    const reportingLink = getAuditReportingLink("Cost", [true, true, true, false, false, true]);
    const settingsLink = getSettingsLink("Cost", [true, true, true, false, false, true]);

    expect(reportingLink?.iconName).toBe("cost");
    expect(settingsLink?.iconName).toBe("cost");
  });

  it("uses distinct icons for Webhooks, Access audit, and Audit trail", () => {
    const options: Parameters<typeof buildAdminNav> = [true, true, true, false, false, true];

    expect(getSettingsLink("Webhooks", options)?.iconName).toBe("webhook");
    expect(getAuditReportingLink("Access audit", options)?.iconName).toBe("access-audit");
    expect(getAuditReportingLink("Audit trail", options)?.iconName).toBe("audit");
  });

  it("does not expose API Tokens in settings navigation", () => {
    const apiTokensLink = getSettingsLink("API tokens", [true, true, true, false, true, true]);

    expect(apiTokensLink).toBeUndefined();
  });

  it("exposes Authentication in settings navigation", () => {
    const authenticationLink = getSettingsLink("Authentication", [true, true, false, false, false, true]);

    expect(authenticationLink?.to).toBe("/admin/authentication-settings");
  });

  it("places Production readiness with the deployment settings", () => {
    const settingsSection = buildAdminNav(true, true, false, false, false, true).find(
      (section) => section.label === "Settings",
    );

    expect(settingsSection?.links.map((link) => link.label)).toEqual([
      "General",
      "Authentication",
      "Manager",
      "Browser",
      "Portal",
      "Cost",
      "Webhooks",
      "Production readiness",
      "Key Rotation",
    ]);
  });

  it("groups identity administration with a dedicated security icon", () => {
    const identityAccess = buildAdminNav(true, true, false, false, false, true).find(
      (section) => section.label === "Identity & Access"
    );

    expect(identityAccess?.links.map((link) => link.label)).toEqual([
      "UI Users",
      "UI Groups",
      "Identity Security",
    ]);
    expect(identityAccess?.links.find((link) => link.label === "Identity Security")?.iconName).toBe("shield");
  });

  it("adds exact pending request badges and hides zero counts", () => {
    const populated = buildAdminNav(
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      { identity_link_requests: 2, portal_requests: 5 },
    );
    const empty = buildAdminNav(
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      { identity_link_requests: 0, portal_requests: 0 },
    );

    const identityLink = populated
      .find((section) => section.label === "Identity & Access")
      ?.links.find((link) => link.label === "Identity Security");
    const portalLink = populated
      .find((section) => section.label === "Audit & Reporting")
      ?.links.find((link) => link.label === "Portal Requests");
    expect(identityLink).toMatchObject({
      badge: "2",
      badgeAriaLabel: "2 pending identity link requests",
      badgeTone: "attention",
    });
    expect(portalLink).toMatchObject({
      badge: "5",
      badgeAriaLabel: "5 pending Portal requests",
      badgeTone: "attention",
    });
    expect(
      empty
        .find((section) => section.label === "Identity & Access")
        ?.links.find((link) => link.label === "Identity Security")?.badge,
    ).toBeUndefined();
    expect(
      empty
        .find((section) => section.label === "Audit & Reporting")
        ?.links.find((link) => link.label === "Portal Requests")?.badge,
    ).toBeUndefined();
  });

  it("keeps Portal Requests hidden when Portal is disabled even with pending requests", () => {
    const adminNav = buildAdminNav(
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      { identity_link_requests: 0, portal_requests: 5 },
    );

    expect(
      adminNav
        .find((section) => section.label === "Audit & Reporting")
        ?.links.find((link) => link.label === "Portal Requests"),
    ).toBeUndefined();
  });

  it("keeps settings collapsed until the admin settings route asks for expansion", () => {
    const baseArgs = [true, true, false, false, false, true] as const;

    const settingsSection = buildAdminNav(...baseArgs).find((section) => section.label === "Settings");
    expect(settingsSection?.id).toBe("settings");
    expect(settingsSection?.collapsible).toBe(true);
    expect(settingsSection?.collapsed).toBe(true);
    expect(buildAdminNav(...baseArgs, true).find((section) => section.label === "Settings")?.collapsed).toBe(false);
  });

  it("exposes Usage History only when usage history is enabled", () => {
    const enabledLink = getAuditReportingLink("Usage History", [true, true, false, true, false, true]);
    const disabledLink = getAuditReportingLink("Usage History", [true, true, false, false, false, true]);

    expect(enabledLink?.to).toBe("/admin/usage-history");
    expect(disabledLink).toBeUndefined();
  });

  it("exposes Portal Requests only when Portal is enabled", () => {
    const enabledLink = getAuditReportingLink("Portal Requests", [true, true, false, false, false, true]);
    const disabledLink = getAuditReportingLink("Portal Requests", [false, true, false, false, false, true]);

    expect(enabledLink?.to).toBe("/admin/portal-requests");
    expect(disabledLink).toBeUndefined();
  });

  it("groups metrics after managed tenant links and cost with audit reporting", () => {
    const adminNav = buildAdminNav(true, true, true, true, false, true);
    const dashboard = adminNav[0];
    const setup = adminNav.find((section) => section.label === "Setup");
    const managedTenants = adminNav.find((section) => section.label === "Managed Tenants");
    const auditReporting = adminNav.find((section) => section.label === "Audit & Reporting");

    expect(dashboard?.label).toBeUndefined();
    expect(dashboard?.links.map((link) => link.label)).toEqual(["Dashboard"]);
    expect(setup?.links.map((link) => link.label)).toEqual(["Getting started"]);
    expect(managedTenants?.links.map((link) => link.label)).toEqual([
      "RGW Accounts",
      "RGW Users",
      "Usage & Metrics",
    ]);
    expect(auditReporting?.links.map((link) => link.label)).toEqual([
      "Portal Requests",
      "Cost",
      "Usage History",
      "Access audit",
      "Audit trail",
    ]);
    expect(setup?.links.find((link) => link.label === "Getting started")?.iconName).toBe("tools");
  });

  it("keeps the shared Dashboard icon when the Admin label is localized", () => {
    const adminNav = buildAdminNav(
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      null,
      false,
      (message) => (message === "Dashboard" ? "Tableau de bord" : message),
    );

    expect(adminNav[0]?.links[0]).toMatchObject({
      label: "Tableau de bord",
      to: "/admin",
      iconName: "home",
    });
  });

  it("hides Getting started after onboarding is complete or dismissed", () => {
    const adminNav = buildAdminNav(true, true, false, false, false, true, false, null, false);

    expect(adminNav[0]?.label).toBeUndefined();
    expect(adminNav[0]?.links.map((link) => link.label)).toEqual(["Dashboard"]);
    expect(adminNav.find((section) => section.label === "Setup")).toBeUndefined();
  });
});
