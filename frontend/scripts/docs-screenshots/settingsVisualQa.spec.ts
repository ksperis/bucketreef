import { buildPortalSettingsRules } from "./fixtures/portalSettings";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { buildBaseRules } from "./fixtures/base";
import { registerApiMocks } from "./mockApi";
import { portalUser, superAdminUser } from "./fixtures/users";
import { seedUiPreferences } from "./uiPreferences";
import type { PortalProjectSettings } from "../../src/api/portalAccounts";
import { writeFile } from "node:fs/promises";

async function recordSettingsGeometry(page: Page, testInfo: TestInfo) {
  const geometry = await page.evaluate(() => {
    const measure = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((element) => element.getBoundingClientRect().height > 0)
      .map((element) => {
        const style = getComputedStyle(element);
        return { height: element.getBoundingClientRect().height, fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight };
      });
    return { sections: measure(".settings-section-compact"), rows: measure(".settings-item-compact"), buttons: measure(".settings-control.ui-button-base"), controls: measure("input.settings-control, select.settings-control"), labels: measure(".settings-item-compact h3"), titles: measure(".settings-section-compact h2"), descriptions: measure(".settings-item-description"), touch: innerWidth < 1024 || matchMedia("(any-pointer: coarse)").matches };
  });
  const path = testInfo.outputPath("settings-geometry.json");
  await writeFile(path, JSON.stringify(geometry, null, 2));
  await testInfo.attach("settings-geometry", { path, contentType: "application/json" });
  for (const button of geometry.buttons) {
    expect(button.height).toBeGreaterThanOrEqual(geometry.touch ? 44 : 28);
    expect(button.fontSize).toBe("12px");
    expect(button.fontWeight).toBe("400");
  }
  expect(geometry.controls.every((control) => control.fontSize === "13px")).toBe(true);
  expect(geometry.labels.every((label) => label.fontSize === "13px" && label.fontWeight === "500")).toBe(true);
  expect(geometry.titles.every((title) => title.fontSize === "14px")).toBe(true);
  expect(geometry.descriptions.every((description) => description.fontSize === "12px" && description.lineHeight === "16px")).toBe(true);
}

for (const mode of ["touch-desktop", "200-percent-reflow"] as const) {
  test(`compact settings ${mode}`, async ({ browser }, testInfo) => {
    // 720 × 450 CSS pixels at scale 2 reproduces the reflow of a 1440 × 900 viewport at 200%.
    const context = await browser.newContext({
      viewport: mode === "touch-desktop" ? { width: 1440, height: 900 } : { width: 720, height: 450 },
      hasTouch: mode === "touch-desktop", deviceScaleFactor: mode === "touch-desktop" ? 1 : 2,
    });
    try {
      const page = await context.newPage();
      const registry = await registerApiMocks(page, buildPortalSettingsRules(), `density-${mode}`, { ...portalUser, ui_language: "de" });
      await seedUiPreferences(page, { selectedWorkspace: "portal", selectedPortalAccountId: "101", theme: "dark" });
      await page.goto("http://127.0.0.1:4173/portal/storage-spaces/genomics-2026?tab=settings");
      const edit = page.getByRole("button", { name: "Details bearbeiten", exact: true });
      await expect(edit).toBeVisible();
      await recordSettingsGeometry(page, testInfo);
      for (const selector of [".settings-button", ".settings-switch-target"]) {
        const bounds = await page.locator(selector).evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()).filter((rect) => rect.width > 0).map(({ width, height }) => ({ width, height })));
        expect(bounds.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
      await edit.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("textbox").first()).toBeFocused();
      expect(await dialog.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(2);
      const padding = await dialog.locator(".modal-body").evaluate((node) => ({ x: getComputedStyle(node).paddingLeft, y: getComputedStyle(node).paddingTop }));
      expect(padding).toEqual({ x: "16px", y: "12px" });
      await page.screenshot({ path: testInfo.outputPath(`${mode}.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(edit).toBeFocused();
      registry.assertNoUnmatched();
    } finally { await context.close(); }
  });
}

for (const locale of ["en", "fr", "de"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`profile density with two sessions ${locale} ${theme}`, async ({ page }, testInfo) => {
      const now = Date.now();
      const sessions = [true, false].map((current, index) => ({
        id: `density-session-${index}`, principal_type: "ui_user", auth_type: "password", current,
        created_at: new Date(now - 3600000).toISOString(), last_activity_at: new Date(now - 60000).toISOString(),
        idle_expires_at: new Date(now + 3600000).toISOString(), absolute_expires_at: new Date(now + 86400000).toISOString(),
        user_agent: current ? "Mozilla/5.0 (X11; Linux x86_64) Chrome/128.0.0.0 Safari/537.36" : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari/605.1.15",
      }));
      const registry = await registerApiMocks(page, [
        { id: "density-passkeys", path: /^\/auth\/security\/webauthn\/credentials$/, body: [{ id: "density-key", name: "Laptop", created_at: new Date(now).toISOString() }] },
        { id: "density-identities", path: /^\/auth\/security\/external-identities$/, body: [] },
        { id: "density-sessions", path: /^\/auth\/sessions$/, body: sessions },
        ...buildPortalSettingsRules(),
      ], "profile-density", { ...portalUser, ui_language: locale });
      await page.setViewportSize({ width: 1440, height: 900 });
      await seedUiPreferences(page, { selectedWorkspace: "portal", selectedPortalAccountId: "101", theme });
      await page.goto("/portal/profile?tab=security");
      const region = page.getByRole("region", { name: { en: "Open sessions", fr: "Sessions ouvertes", de: "Offene Sitzungen" }[locale] });
      await expect(region.locator(".settings-item-compact")).toHaveCount(2);
      await expect(page.locator(".settings-section-compact")).toHaveCount(3);
      const bounds = await region.boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
      await recordSettingsGeometry(page, testInfo);
      await page.screenshot({ path: testInfo.outputPath(`profile-${locale}-${theme}.png`), animations: "disabled" });
      registry.assertNoUnmatched();
    });
  }
}

for (const locale of ["en", "fr", "de"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [1440, 390]) {
      test(`compact Portal settings ${locale} ${theme} ${width}`, async ({
        page,
      }, testInfo) => {
        const rules = buildBaseRules().map((rule) =>
          rule.id === "portal-project-settings"
            ? {
                ...rule,
                body: {
                  ...(rule.body as PortalProjectSettings),
                  can_update: true,
                  delegated_to_portal_managers: true,
                },
              }
            : rule.id === "branding" && locale === "de"
              ? {
                  ...rule,
                  body: { primary_color: "#7c3aed", login_logo_url: null },
                }
              : rule,
        );
        const registry = await registerApiMocks(
          page,
          rules,
          "compact-portal-settings",
          { ...portalUser, ui_language: locale },
        );
        await page.setViewportSize({ width, height: 900 });
        await seedUiPreferences(page, {
          selectedWorkspace: "portal",
          selectedPortalAccountId: "101",
          theme,
        });
        await page.goto("/portal/settings");
        const customize = {
          en: "Customize — CORS origins",
          fr: "Personnaliser — Origines CORS",
          de: "Anpassen — CORS-Ursprünge",
        }[locale];
        await expect(
          page.getByRole("switch", { name: customize }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        ).toBeLessThanOrEqual(2);
        await recordSettingsGeometry(page, testInfo);
        await page.screenshot({
          path: testInfo.outputPath(
            `portal-settings-${locale}-${theme}-${width}.png`,
          ),
          fullPage: true,
          animations: "disabled",
        });
        await page.getByRole("switch", { name: customize }).click();
        await page
          .getByRole("button", {
            name: { en: "Configure", fr: "Configurer", de: "Konfigurieren" }[
              locale
            ],
            exact: true,
          })
          .click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("textbox")).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        if (width === 390)
          expect(
            await page
              .getByRole("switch", { name: customize })
              .evaluate((element) => element.getBoundingClientRect().height),
          ).toBeGreaterThanOrEqual(44);
        registry.assertNoUnmatched();
      });
    }
  }
}

for (const locale of ["en", "fr", "de"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [1440, 390]) {
      test(`space settings coherence ${locale} ${theme} ${width}`, async ({ page }, testInfo) => {
        const rules = buildPortalSettingsRules().map((rule) => rule.id === "branding" && locale === "de"
          ? { ...rule, body: { primary_color: "#7c3aed", login_logo_url: null } } : rule);
        const registry = await registerApiMocks(page, rules, "space-settings-coherence", { ...portalUser, ui_language: locale });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize({ width, height: 900 });
        await seedUiPreferences(page, { selectedWorkspace: "portal", selectedPortalAccountId: "101", theme });
        await page.goto("/portal/storage-spaces/genomics-2026?tab=settings");
        const switchName = { en: "Keep file versions", fr: "Conserver les versions des fichiers", de: "Dateiversionen aufbewahren" }[locale];
        const edit = { en: "Edit details", fr: "Modifier", de: "Details bearbeiten" }[locale];
        await expect(page.getByRole("switch", { name: switchName })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
        if (width === 390) {
          expect(await page.getByRole("button", { name: edit, exact: true }).evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
          expect(await page.getByRole("switch", { name: switchName }).evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
        }
        await recordSettingsGeometry(page, testInfo);
        await page.screenshot({ path: testInfo.outputPath(`space-settings-${locale}-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
        if (width === 390) {
          await page.getByRole("heading", { name: { en: "Space management", fr: "Gestion de l’espace", de: "Bereich verwalten" }[locale], exact: true }).scrollIntoViewIfNeeded();
          await page.screenshot({ path: testInfo.outputPath(`space-management-${locale}-${theme}-${width}.png`), animations: "disabled" });
        }
        const editButton = page.getByRole("button", { name: edit, exact: true });
        if (locale === "de" && width === 1440) {
          await editButton.evaluate((node) => { node.style.width = "80px"; });
          const wrapped = await editButton.evaluate((node) => ({ height: node.getBoundingClientRect().height, overflow: node.scrollWidth - node.clientWidth }));
          expect(wrapped.height).toBeGreaterThan(28);
          expect(wrapped.overflow).toBeLessThanOrEqual(1);
          await editButton.evaluate((node) => { node.style.removeProperty("width"); });
          await editButton.focus();
          await page.keyboard.press("Enter");
        } else await editButton.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByRole("textbox").first()).toBeFocused();
        await dialog.getByRole("textbox").last().fill("Draft description");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(2);
        await page.getByRole("button", { name: { en: "Keep editing", fr: "Continuer la modification", de: "Weiter bearbeiten" }[locale] }).click();
        await expect(dialog.getByRole("textbox").last()).toHaveValue("Draft description");
        await page.screenshot({ path: testInfo.outputPath(`space-identity-${locale}-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
        expect(errors).toEqual([]);
        registry.assertNoUnmatched();
      });
    }
  }
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`Admin Portal settings coherence ${theme} ${width}`, async ({ page }, testInfo) => {
      const rules = buildPortalSettingsRules().map((rule) => rule.id === "branding" && theme === "dark"
        ? { ...rule, body: { primary_color: "#7c3aed", login_logo_url: null } } : rule);
      const registry = await registerApiMocks(page, rules, "admin-portal-settings-coherence", { ...superAdminUser, ui_language: "de" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await seedUiPreferences(page, { selectedWorkspace: "admin", theme });
      await page.goto("/admin/s3-accounts");
      await page.getByRole("button", { name: "Edit", exact: true }).first().click();
      await page.getByRole("tab", { name: "Portal settings", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Allowed features" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
      await page.getByRole("combobox", { name: "Browser workspace access" }).selectOption("disabled");
      await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
      await recordSettingsGeometry(page, testInfo);
      await page.screenshot({ path: testInfo.outputPath(`admin-project-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
      await page.getByRole("switch", { name: "Customize — CORS origins" }).click();
      await page.getByRole("button", { name: "Configure", exact: true }).click();
      await expect(page.getByRole("dialog").getByRole("textbox")).toBeFocused();
      expect(errors).toEqual([]);
      registry.assertNoUnmatched();
    });
  }
}
