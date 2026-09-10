import { expect, test, type Page } from "@playwright/test";

import { buildBaseRules } from "./fixtures/base";
import { registerApiMocks } from "./mockApi";
import { portalUser } from "./fixtures/users";
import { seedUiPreferences } from "./uiPreferences";
import type { PortalAccessKey, PortalAccessKeysState } from "../../src/api/portalAccessKeys";

type PortalVisualLocale = "en" | "fr" | "de";

const portalRoutes = [
  {
    path: "/portal",
    expected: { en: "Dashboard", fr: "Tableau de bord", de: "Dashboard" },
  },
  {
    path: "/portal/storage-spaces",
    expected: { en: "Spaces", fr: "Espaces", de: "Bereiche" },
  },
  {
    path: "/portal/storage-spaces/genomics-2026?prefix=raw-data%2F2024%2F03%2F",
    expected: {
      en: "sample_001.fastq.gz",
      fr: "sample_001.fastq.gz",
      de: "sample_001.fastq.gz",
    },
  },
  {
    path: "/portal/storage-spaces/genomics-2026?tab=settings",
    expected: {
      en: "Version history settings",
      fr: "Paramètres de l’historique des versions",
      de: "Einstellungen für den Versionsverlauf",
    },
  },
  {
    path: "/portal/storage-spaces/genomics-2026?tab=statistics",
    expected: {
      en: "File composition",
      fr: "Composition des fichiers",
      de: "Dateizusammensetzung",
    },
  },
  {
    path: "/portal/storage-spaces/genomics-2026?prefix=raw-data%2F2024%2F03%2F&object=raw-data%2F2024%2F03%2Fsample_001.fastq.gz&object_view=details",
    expected: {
      en: "General information",
      fr: "Informations générales",
      de: "Allgemeine Informationen",
    },
  },
  {
    path: "/portal/shares",
    expected: { en: "Collaborators", fr: "Collaborateurs", de: "Mitwirkende" },
  },
  {
    path: "/portal/history",
    expected: { en: "History", fr: "Historique", de: "Verlauf" },
  },
  {
    path: "/portal/history?view=transfers",
    expected: { en: "Activity", fr: "Activité", de: "Aktivität" },
  },
  {
    path: "/portal/usage",
    expected: {
      en: "Storage health",
      fr: "État du stockage",
      de: "Speicherstatus",
    },
  },
  {
    path: "/portal/access-keys",
    expected: {
      en: "External S3 tools",
      fr: "Outils S3 externes",
      de: "Externe S3-Werkzeuge",
    },
  },
  {
    path: "/portal/requests",
    expected: {
      en: "Help requests",
      fr: "Demandes d'aide",
      de: "Hilfeanfragen",
    },
  },
  {
    path: "/portal/settings",
    expected: { en: "Settings", fr: "Paramètres", de: "Einstellungen" },
  },
];

const viewports = [
  { name: "desktop", width: 1728, height: 972 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
];

const themes = ["light", "dark"] as const;

const locales: PortalVisualLocale[] = ["en", "fr", "de"];

const connectToolLabels = {
  en: {
    configure: "Configure a tool",
    dialog: "Connect a tool",
    advanced: "Advanced tools and manual setup",
    close: "Close modal",
    manual: "Other S3-compatible application",
    directConnect: "Connect Myself",
  },
  fr: {
    configure: "Configurer un outil",
    dialog: "Connecter un outil",
    advanced: "Outils avancés et configuration manuelle",
    close: "Fermer la fenêtre",
    manual: "Autre application compatible S3",
    directConnect: "Connecter Moi-même",
  },
  de: {
    configure: "Werkzeug konfigurieren",
    dialog: "Werkzeug verbinden",
    advanced: "Erweiterte Werkzeuge und manuelle Einrichtung",
    close: "Dialog schließen",
    manual: "Andere S3-kompatible Anwendung",
    directConnect: "Verbinden Ich selbst",
  },
} satisfies Record<
  PortalVisualLocale,
  { configure: string; dialog: string; advanced: string; close: string; manual: string; directConnect: string }
>;

function buildPortalUser(language: PortalVisualLocale) {
  return { ...portalUser, ui_language: language };
}

async function openPortalRoute(
  page: Page,
  routePath: string,
  scenarioId: string,
  theme: (typeof themes)[number],
  language: PortalVisualLocale,
) {
  const user = buildPortalUser(language);
  const mockRegistry = await registerApiMocks(
    page,
    buildBaseRules(),
    scenarioId,
    user,
  );
  await page.emulateMedia({ colorScheme: theme });
  await seedUiPreferences(page, {
    selectedWorkspace: "portal",
    selectedPortalAccountId: "101",
    theme,
  });
  await page.goto(routePath, { waitUntil: "domcontentloaded" });
  return mockRegistry;
}

test.describe("Portal visual QA", () => {
  for (const viewport of viewports) {
    for (const theme of themes) {
      for (const language of locales) {
        for (const route of portalRoutes) {
          test(`${viewport.name} ${theme} ${language} ${route.path}`, async ({
            page,
          }, testInfo) => {
            await page.setViewportSize({
              width: route.path === "/portal/access-keys" && viewport.name === "desktop" ? 1440 : viewport.width,
              height: route.path === "/portal/access-keys" && viewport.name === "desktop" ? 900 : viewport.height,
            });
            const mockRegistry = await openPortalRoute(
              page,
              route.path,
              `portal-visual-qa-${viewport.name}-${theme}-${language}-${route.path}`,
              theme,
              language,
            );

            const main = page.locator("main");
            await expect(
              main
                .getByText(route.expected[language], { exact: false })
                .first(),
            ).toBeVisible();
            await expect(
              main.getByText("/portal/browser", { exact: false }),
            ).toHaveCount(0);
            if (
              route.path.startsWith("/portal/storage-spaces/") &&
              !new URL(route.path, "http://localhost").searchParams.has("object") &&
              !route.path.includes("tab=settings") &&
              !route.path.includes("tab=statistics")
            ) {
              await expect(
                main.getByRole("button", { name: "Selected storage space" }),
              ).toBeVisible();
              await expect(
                main.getByRole("button", { name: "Search options" }),
              ).toHaveCount(0);
            }
            if (route.path === "/portal/access-keys") {
              const labels = connectToolLabels[language];
              await page.screenshot({ path: testInfo.outputPath("01-access-list.png"), fullPage: true });
              const directConnectButton = main.getByRole("button", {
                name: new RegExp(`^${labels.directConnect}`),
              });
              await directConnectButton.click();
              const directDialog = page.getByRole("dialog", { name: labels.dialog });
              await expect(directDialog).toBeVisible();
              await page.keyboard.press("Escape");
              await expect(directDialog).toBeHidden();
              await expect(directConnectButton).toBeFocused();
              await expect(main.getByRole("tablist")).toHaveCount(0);
              await main.getByRole("button", { name: labels.configure }).click();
              const dialog = page.getByRole("dialog", { name: labels.dialog });
              await expect(dialog).toBeVisible();
              await expect(dialog.getByText("Cyberduck / Mountain Duck", { exact: true })).toBeVisible();
              await expect(dialog.getByText("WinSCP", { exact: true })).toBeVisible();
              await expect(dialog.locator("details")).not.toHaveAttribute("open", "");
              await expect(dialog.getByText(labels.advanced, { exact: true })).toBeVisible();
              await expect(dialog.getByRole("button", { name: labels.close })).toBeVisible();
              await page.screenshot({ path: testInfo.outputPath("02-configurator.png"), fullPage: true });
              await dialog.getByText(labels.advanced, { exact: true }).click();
              await expect(dialog.locator("details")).toHaveAttribute("open", "");
              await expect(dialog.getByText("rclone", { exact: true })).toBeVisible();
              await expect(dialog.getByRole("heading", { name: labels.manual })).toBeVisible();
              await page.keyboard.press("Escape");
              await expect(dialog).toBeHidden();
              await expect(main.getByRole("button", { name: labels.configure })).toBeFocused();
            }

            const horizontalOverflow = await page.evaluate(
              () =>
                Math.max(
                  document.documentElement.scrollWidth,
                  document.body.scrollWidth,
                ) - window.innerWidth,
            );
            expect(horizontalOverflow).toBeLessThanOrEqual(2);

            let activeElement = await page.evaluate(() => {
              const active = document.activeElement;
              return {
                tag: active?.tagName ?? null,
                ariaLabel: active?.getAttribute("aria-label") ?? null,
                text: active?.textContent?.trim().slice(0, 80) ?? null,
              };
            });
            if (activeElement.tag === "BODY") {
              await page.keyboard.press("Tab");
              activeElement = await page.evaluate(() => {
                const active = document.activeElement;
                return {
                  tag: active?.tagName ?? null,
                  ariaLabel: active?.getAttribute("aria-label") ?? null,
                  text: active?.textContent?.trim().slice(0, 80) ?? null,
                };
              });
            }
            expect(activeElement.tag).not.toBe("BODY");

            mockRegistry.assertNoUnmatched();
          });
        }
      }
    }
  }
});

for (const target of ["self", "external"] as const) {
  for (const mobile of [false, true]) {
    test(`tool creation handoff ${target} ${mobile ? "mobile" : "desktop"}`, async ({ page }, testInfo) => {
      test.setTimeout(30_000);
      const rules = buildBaseRules();
      const initialState = rules.find((rule) => rule.id === "portal-access-keys")!.body as PortalAccessKeysState;
      const key: PortalAccessKey = {
        access_key_id: "FIXTURE-TOOL-ACCESS", is_active: true, status: "Active", target_type: target,
        created_at: "2026-09-10T10:00:00Z",
        ...(target === "external" ? {
          external_email: "partner@example.test", permission: "read_only",
          storage_space_name: "genomics-2026", bucket_name: "rgw-portal-genomics-2026",
        } as const : {}),
      };
      // Synthetic value only: this test never creates real credentials.
      const fakeSecret = "EXAMPLE-ONLY-NOT-A-REAL-SECRET";
      let created = false;
      const registry = await registerApiMocks(page, [
        { id: "create-tool-access", method: "POST", path: /^\/portal\/access-keys$/, body: ({ requestBodyText }) => {
          expect(JSON.parse(requestBodyText).target_type).toBe(target);
          created = true;
          return { ...key, secret_access_key: fakeSecret };
        } },
        { id: "tool-access-list", method: "GET", path: /^\/portal\/access-keys$/, body: () => ({
          ...initialState, max_access_keys: 3,
          access_keys: created ? [...initialState.access_keys, key] : initialState.access_keys,
        }) },
        ...rules,
      ], "direct-tool-handoff", buildPortalUser("fr"));
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      await seedUiPreferences(page, { selectedWorkspace: "portal", selectedPortalAccountId: "101", theme: mobile ? "dark" : "light" });
      await page.goto("/portal/access-keys");
      const main = page.locator("main");
      await expect(main.getByRole("button", { name: "Nouvel accès outil" })).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath("01-access-list.png"), fullPage: true });
      await main.getByRole("button", { name: "Nouvel accès outil" }).click();
      const workflow = page.locator(".workflow-page");
      await expect(workflow.getByRole("heading", { name: "Créer un accès outil S3" })).toBeVisible();
      if (target === "external") {
        await workflow.getByRole("radio", { name: "Pour un utilisateur externe" }).check();
        await workflow.getByPlaceholder("nom@example.org").fill("partner@example.test");
        await workflow.getByRole("combobox", { name: "Espace", exact: true }).selectOption("genomics-2026");
      }
      await page.screenshot({ path: testInfo.outputPath("02-create-access.png"), fullPage: true });
      await workflow.getByRole("button", { name: "Créer l'accès", exact: true }).click();
      const secret = main.getByText(fakeSecret, { exact: true });
      await expect(secret).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(main.getByRole("table")).toBeVisible();
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await main.getByRole("button", { name: "Copier la clé secrète" }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fakeSecret);
      await page.screenshot({ path: testInfo.outputPath("03-copy-secret.png"), fullPage: true });
      const configure = main.getByRole("button", { name: "Configurer un outil" });
      await configure.click();
      const dialog = page.getByRole("dialog", { name: "Connecter un outil" });
      await expect(dialog.getByRole("combobox", { name: "Accès utilisé" })).toHaveValue(key.access_key_id);
      await expect(dialog.getByText(fakeSecret)).toHaveCount(0);
      await expect(dialog.getByRole("heading", { name: "Cyberduck / Mountain Duck" })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("04-configurator.png"), fullPage: true });
      await dialog.getByRole("button", { name: "Fermer la fenêtre" }).click();
      await expect(configure).toBeFocused();
      await expect(secret).toBeVisible();
      await expect(main.getByRole("table")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("05-return-to-list.png"), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
      registry.assertNoUnmatched();
    });
  }
}
