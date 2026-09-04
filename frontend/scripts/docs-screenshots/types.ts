import type { AuthUser } from "../../src/api/auth";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ScreenshotThemeVariant = "light" | "dark";

export type LocalStorageSeed = {
  selectedWorkspace?: "admin" | "manager" | "portal" | "browser" | "ceph-admin" | "storage-ops";
  selectedManagerExecutionContextId?: string;
  selectedBrowserExecutionContextId?: string;
  selectedPortalAccountId?: string;
  selectedCephAdminEndpointId?: string;
  theme?: "light" | "dark";
  extraEntries?: Record<string, string>;
  extraSessionEntries?: Record<string, string>;
};

type MockResponse = Record<string, unknown> | readonly unknown[] | string | number | boolean | null | undefined;

export type MockRule = {
  id: string;
  method?: HttpMethod;
  path: RegExp;
  status?: number;
  delayMs?: number;
  body:
    | MockResponse
    | ((ctx: {
        url: URL;
        method: string;
        requestBodyText: string;
      }) => MockResponse);
};

export type ScenarioAction =
  | { type: "click"; selector: string }
  | { type: "wait"; selector: string }
  | { type: "fill"; selector: string; value: string }
  | { type: "select"; selector: string; value: string }
  | { type: "press"; selector: string; key: string };

export type DocScreenshotScenario = {
  id: string;
  docPage: string;
  route: string;
  outputBasename: string;
  waitFor: string;
  user: AuthUser;
  storage: LocalStorageSeed;
  actions?: ScenarioAction[];
  mockRules: MockRule[];
  postScreenshotWaitMs?: number;
  postScreenshotActions?: ScenarioAction[];
};
