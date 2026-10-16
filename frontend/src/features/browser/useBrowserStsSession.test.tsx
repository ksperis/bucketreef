import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StsCredentials } from "../../api/browserContracts";
import { LanguageProvider, useLanguage } from "../../components/language";
import { useBrowserStsSession } from "./useBrowserStsSession";

const apiMocks = vi.hoisted(() => ({
  getBrowserStsCredentials: vi.fn(),
  getBrowserStsStatus: vi.fn(),
}));

vi.mock("../../api/browserSts", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browserSts")>(
      "../../api/browserSts",
    );
  return {
    ...actual,
    getBrowserStsCredentials: (...args: unknown[]) =>
      apiMocks.getBrowserStsCredentials(...args),
    getBrowserStsStatus: (...args: unknown[]) =>
      apiMocks.getBrowserStsStatus(...args),
  };
});

function credentials(accessKeyId: string): StsCredentials {
  return {
    access_key_id: accessKeyId,
    secret_access_key: `secret-${accessKeyId}`,
    session_token: `token-${accessKeyId}`,
    expiration: "2099-01-01T00:00:00Z",
    endpoint: "https://s3.example.test",
    region: "us-east-1",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("useBrowserStsSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getBrowserStsStatus.mockResolvedValue({ available: true });
    apiMocks.getBrowserStsCredentials.mockResolvedValue(credentials("key-1"));
  });

  it("prefetches and reuses unexpired credentials for the active scope", async () => {
    const { result } = renderHook(() =>
      useBrowserStsSession({
        contextIdForApi: "acc-1",
        enabled: true,
        hasContext: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.credentials?.access_key_id).toBe("key-1");
    });

    let cachedCredentials: StsCredentials | null = null;
    await act(async () => {
      cachedCredentials = await result.current.ensureCredentials();
    });

    expect(cachedCredentials?.access_key_id).toBe("key-1");
    expect(apiMocks.getBrowserStsCredentials).toHaveBeenCalledTimes(1);
  });

  it("retranslates fallback errors without repeating STS requests when the language changes", async () => {
    apiMocks.getBrowserStsCredentials.mockRejectedValue({});
    const { result } = renderHook(() => ({
      session: useBrowserStsSession({ contextIdForApi: "acc-1", enabled: true, hasContext: true }),
      language: useLanguage(),
    }), { wrapper: LanguageProvider });
    await waitFor(() => expect(result.current.session.credentialsError).toBe("Unable to load STS credentials."));
    await act(async () => result.current.language.setLanguage("fr"));
    expect(result.current.session.credentialsError).toBe("Impossible de charger les identifiants STS.");
    await act(async () => result.current.language.setLanguage("de"));
    expect(result.current.session.credentialsError).toBe("STS-Zugangsdaten konnten nicht geladen werden.");
    expect(apiMocks.getBrowserStsStatus).toHaveBeenCalledTimes(1);
    expect(apiMocks.getBrowserStsCredentials).toHaveBeenCalledTimes(1);
  });

  it("does not reuse or commit an in-flight request from a previous account", async () => {
    const accountOneRequest = deferred<StsCredentials>();
    const accountTwoRequest = deferred<StsCredentials>();
    apiMocks.getBrowserStsCredentials.mockImplementation((contextId: string) =>
      contextId === "acc-1"
        ? accountOneRequest.promise
        : accountTwoRequest.promise,
    );

    const { result, rerender } = renderHook(
      ({ contextId }) =>
        useBrowserStsSession({
          contextIdForApi: contextId,
          enabled: true,
          hasContext: true,
        }),
      { initialProps: { contextId: "acc-1" } },
    );
    await waitFor(() => {
      expect(apiMocks.getBrowserStsCredentials).toHaveBeenCalledWith(
        "acc-1",
        undefined,
      );
    });

    rerender({ contextId: "acc-2" });
    await waitFor(() => {
      expect(apiMocks.getBrowserStsCredentials).toHaveBeenCalledWith(
        "acc-2",
        undefined,
      );
    });

    await act(async () => {
      accountTwoRequest.resolve(credentials("key-2"));
    });
    await waitFor(() => {
      expect(result.current.credentials?.access_key_id).toBe("key-2");
    });

    await act(async () => {
      accountOneRequest.resolve(credentials("key-1"));
    });
    expect(result.current.credentials?.access_key_id).toBe("key-2");
  });
});
