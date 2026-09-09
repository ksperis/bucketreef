import { expect, test } from "@playwright/test";
import { buildBaseRules } from "./fixtures/base";
import { registerApiMocks } from "./mockApi";
import { portalUser } from "./fixtures/users";
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
