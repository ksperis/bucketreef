import type { Page } from "@playwright/test";
import type { LocalStorageSeed } from "./types";

/** Only UI preferences are persisted; the mock session API owns identity. */
export async function seedUiPreferences(page: Page, storage: LocalStorageSeed) {
  await page.addInitScript((value) => {
    localStorage.clear();
    sessionStorage.clear();
    const preferences = {
      selectedWorkspace: value.selectedWorkspace,
      selectedManagerExecutionContextId: value.selectedManagerExecutionContextId,
      selectedBrowserExecutionContextId: value.selectedBrowserExecutionContextId,
      selectedPortalAccountId: value.selectedPortalAccountId,
      selectedCephAdminEndpointId: value.selectedCephAdminEndpointId,
      theme: value.theme,
      ...value.extraEntries,
    };
    for (const [key, entry] of Object.entries(preferences)) {
      if (entry !== undefined) localStorage.setItem(key, entry);
    }
    for (const [key, entry] of Object.entries(value.extraSessionEntries ?? {})) {
      sessionStorage.setItem(key, entry);
    }
  }, storage);
}
