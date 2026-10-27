import { describe, expect, it } from "vitest";
import adminCatalogs from "bucketreef-i18n/admin";
import browserCatalogs from "bucketreef-i18n/browser";
import cephAdminCatalogs from "bucketreef-i18n/cephAdmin";
import managerCatalogs from "bucketreef-i18n/manager";
import sharedCatalogs from "bucketreef-i18n/shared";
import adminDe from "./features/admin/admin.de.json";
import adminFr from "./features/admin/admin.fr.json";
import adminZh from "./features/admin/admin.zh.json";
import browserDe from "./features/browser/browser.de.json";
import browserFr from "./features/browser/browser.fr.json";
import browserZh from "./features/browser/browser.zh.json";
import cephAdminDe from "./features/cephAdmin/cephAdmin.de.json";
import cephAdminFr from "./features/cephAdmin/cephAdmin.fr.json";
import cephAdminZh from "./features/cephAdmin/cephAdmin.zh.json";
import managerDe from "./features/manager/manager.de.json";
import managerFr from "./features/manager/manager.fr.json";
import managerZh from "./features/manager/manager.zh.json";
import sharedDe from "./features/shared/shared.de.json";
import sharedFr from "./features/shared/shared.fr.json";
import sharedZh from "./features/shared/shared.zh.json";
import { metricsMessage } from "./components/metricsMessage";
import { paginationControlsMessage } from "./components/paginationControlsMessage";
import { shellMessages } from "./components/shellMessages";
import { usageHistoryMessage } from "./components/usageHistoryMessage";
import {
  productionReadinessGroupDescriptions,
  productionReadinessLevelLabels,
  productionReadinessLevelSummaries,
  productionReadinessMessages,
} from "./features/admin/productionReadinessMessages";
import { authMessages } from "./features/auth/authMessages";
import { bucketUsageStatsMessage } from "./features/shared/bucketUsageStatsMessage";
import type { I18nMessage } from "./i18n";



const SHELL_SHARED_MESSAGE_KEYS = [
  "unavailableContext",
  "navigation",
  "unknown",
  "s3Session",
  "superadmin",
  "admin",
  "user",
  "noAccess",
  "session",
  "adminMode",
  "connectionMode",
  "s3UserMode",
] as const;

function englishSources(messageSets: readonly Readonly<Record<string, I18nMessage>>[]): string[] {
  const sources = new Set<string>();
  for (const messages of messageSets) {
    for (const message of Object.values(messages)) {
      if (typeof message !== "string" && message.en) sources.add(message.en);
    }
  }
  return [...sources];
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

function expectCatalogCoverage(
  sources: readonly string[],
  catalogs: Readonly<{ fr: Readonly<Record<string, string>>; de: Readonly<Record<string, string>> }>,
) {
  for (const source of sources) {
    for (const locale of ["fr", "de"] as const) {
      const translation = catalogs[locale][source];
      expect(translation, `${locale} translation missing for: ${source}`).toBeDefined();
      expect(placeholders(translation), `${locale} placeholders differ for: ${source}`).toEqual(
        placeholders(source),
      );
    }
  }
}

const TECHNICAL_TERMS = ["Ceph", "RGW", "S3", "IAM", "CORS", "Bucket", "Tenant"] as const;
const LOCALIZED_TECHNICAL_TERMS: Partial<Record<"fr" | "de" | "zh", ReadonlySet<(typeof TECHNICAL_TERMS)[number]>>> = {
  zh: new Set(["Bucket"]),
};

describe("compact i18n catalogs", () => {
  it("reconstructs every source catalog without changing keys or translations", () => {
    const cases = [
      [adminCatalogs, adminFr, adminDe, adminZh],
      [browserCatalogs, browserFr, browserDe, browserZh],
      [cephAdminCatalogs, cephAdminFr, cephAdminDe, cephAdminZh],
      [managerCatalogs, managerFr, managerDe, managerZh],
      [sharedCatalogs, sharedFr, sharedDe, sharedZh],
    ] as const;

    for (const [catalogs, fr, de, zh] of cases) {
      expect({ ...catalogs.fr }).toEqual(fr);
      expect({ ...catalogs.de }).toEqual(de);
      expect({ ...catalogs.zh }).toEqual(zh);
    }
  });

  it("keeps storage technical terms untranslated", () => {
    const catalogs = [
      ["admin.fr", adminFr],
      ["admin.de", adminDe],
      ["admin.zh", adminZh],
      ["browser.fr", browserFr],
      ["browser.de", browserDe],
      ["browser.zh", browserZh],
      ["cephAdmin.fr", cephAdminFr],
      ["cephAdmin.de", cephAdminDe],
      ["cephAdmin.zh", cephAdminZh],
      ["manager.fr", managerFr],
      ["manager.de", managerDe],
      ["manager.zh", managerZh],
      ["shared.fr", sharedFr],
      ["shared.de", sharedDe],
      ["shared.zh", sharedZh],
    ] as const;

    for (const [catalogName, catalog] of catalogs) {
      const locale = catalogName.slice(catalogName.lastIndexOf(".") + 1) as "fr" | "de" | "zh";
      for (const [source, translation] of Object.entries(catalog)) {
        for (const term of TECHNICAL_TERMS) {
          if (LOCALIZED_TECHNICAL_TERMS[locale]?.has(term)) continue;
          const termPattern = new RegExp(`\\b${term}s?\\b`, "i");
          if (!termPattern.test(source)) continue;

          expect(
            termPattern.test(translation),
            `${catalogName} must preserve ${term} in: ${source}`,
          ).toBe(true);
        }
      }
    }
  });

  it("covers shared message modules in French and German", () => {
    const shellSharedMessages = Object.fromEntries(
      SHELL_SHARED_MESSAGE_KEYS.map((key) => [key, shellMessages[key]]),
    );
    const sources = englishSources([
      authMessages,
      metricsMessage,
      paginationControlsMessage,
      usageHistoryMessage,
      bucketUsageStatsMessage,
      shellSharedMessages,
    ]);

    expectCatalogCoverage(sources, sharedCatalogs);
  });

  it("covers production readiness messages in French and German", () => {
    const sources = englishSources([
      productionReadinessMessages,
      productionReadinessLevelLabels,
      productionReadinessGroupDescriptions,
      productionReadinessLevelSummaries,
    ]);

    expectCatalogCoverage(sources, adminCatalogs);
  });

});
