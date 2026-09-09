import { buildPortalSettingsRules } from "./fixtures/portalSettings";
import { expect, test } from "@playwright/test";
import { buildBaseRules } from "./fixtures/base";
import { registerApiMocks } from "./mockApi";
import { portalUser, superAdminUser } from "./fixtures/users";
import { seedUiPreferences } from "./uiPreferences";
import type { PortalProjectSettings } from "../../src/api/portalAccounts";

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
        await page.screenshot({ path: testInfo.outputPath(`space-settings-${locale}-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
        if (width === 390) {
          await page.getByRole("heading", { name: { en: "Space management", fr: "Gestion de l’espace", de: "Bereich verwalten" }[locale], exact: true }).scrollIntoViewIfNeeded();
          await page.screenshot({ path: testInfo.outputPath(`space-management-${locale}-${theme}-${width}.png`), animations: "disabled" });
        }
        await page.getByRole("button", { name: edit, exact: true }).click();
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
      await page.screenshot({ path: testInfo.outputPath(`admin-project-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
      await page.getByRole("switch", { name: "Customize — CORS origins" }).click();
      await page.getByRole("button", { name: "Configure", exact: true }).click();
      await expect(page.getByRole("dialog").getByRole("textbox")).toBeFocused();
      expect(errors).toEqual([]);
      registry.assertNoUnmatched();
    });
  }
}
