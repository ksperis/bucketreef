import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useBrowserPathRuntime } from "./useBrowserPathRuntime";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  hasOpenModal: vi.fn(),
  navigation: vi.fn(),
  pathEditor: vi.fn(),
  record: vi.fn(),
}));

vi.mock("../../components/ui/modalStack", () => ({
  hasOpenModal: mocks.hasOpenModal,
}));
vi.mock("./useBrowserPathHistory", () => ({
  useBrowserPathHistory: () => ({
    history: ["old/"],
    record: mocks.record,
  }),
}));
vi.mock("./useBrowserPathEditor", () => ({
  useBrowserPathEditor: mocks.pathEditor,
}));
vi.mock("./useBrowserNavigationHistory", () => ({
  useBrowserNavigationHistory: mocks.navigation,
}));

const editorState = {
  activeSuggestionIndex: -1,
  applySuggestion: vi.fn(),
  cancel: mocks.cancel,
  commit: vi.fn(),
  editing: false,
  handleKeyDown: vi.fn(),
  inputRef: { current: null },
  setActiveSuggestionIndex: vi.fn(),
  setValue: vi.fn(),
  startEditing: vi.fn(),
  suggestions: [],
  suggestionsLoading: false,
  value: "",
};

const options = () => ({
  contextId: "ctx-1",
  bucketName: "bucket-a",
  prefix: "reports/2026/",
  localPrefixes: ["reports/2026/q1/"],
  enabled: true,
  requestOptions: { workspaceSurface: "browser" as const },
  requestTransition: vi.fn((transition: () => void) => {
    transition();
    return true;
  }),
  setPrefix: vi.fn(),
  clearActiveItem: vi.fn(),
  selectionReady: true,
  contextSwitchInFlight: false,
  normalizedPath: "/browser",
  accessContextKey: "browser:ctx-1",
  lockedBucketName: "",
});

describe("useBrowserPathRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasOpenModal.mockReturnValue(false);
    mocks.pathEditor.mockReturnValue(editorState);
  });

  it("projects the current path and wires the path editor", () => {
    const runtimeOptions = options();
    const { result } = renderHook(() => useBrowserPathRuntime(runtimeOptions));

    expect(result.current.breadcrumbs).toEqual([
      { label: "reports", prefix: "reports/" },
      { label: "2026", prefix: "reports/2026/" },
    ]);
    expect(result.current.canGoUp).toBe(true);
    expect(result.current.currentPath).toBe("bucket-a/reports/2026");
    expect(mocks.pathEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        contextId: "ctx-1",
        bucketName: "bucket-a",
        history: ["old/"],
        localPrefixes: ["reports/2026/q1/"],
        prefix: "reports/2026/",
      }),
    );
    expect(mocks.navigation).toHaveBeenCalledWith(
      expect.objectContaining({
        bucketName: "bucket-a",
        prefix: "reports/2026/",
        ready: true,
        scopeKey: "/browser:browser:ctx-1:",
      }),
    );
  });

  it("selects prefixes and records path history through the drawer transition", () => {
    const runtimeOptions = options();
    const { result } = renderHook(() => useBrowserPathRuntime(runtimeOptions));

    act(() => {
      result.current.selectPrefix("reports/2026/q1/");
    });

    expect(runtimeOptions.requestTransition).toHaveBeenCalledTimes(1);
    expect(runtimeOptions.setPrefix).toHaveBeenCalledWith("reports/2026/q1/");
    expect(runtimeOptions.clearActiveItem).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledWith("reports/2026/q1/");
  });

  it("moves to the parent prefix through the same transition contract", () => {
    const runtimeOptions = options();
    const { result } = renderHook(() => useBrowserPathRuntime(runtimeOptions));

    act(() => {
      result.current.goUp();
    });

    expect(runtimeOptions.setPrefix).toHaveBeenCalledWith("reports/");
    expect(mocks.record).toHaveBeenCalledWith("reports/");
  });

  it("applies route history only when no modal blocks navigation", () => {
    const runtimeOptions = options();
    renderHook(() => useBrowserPathRuntime(runtimeOptions));
    const navigationOptions = mocks.navigation.mock.calls.at(-1)?.[0];

    act(() => {
      navigationOptions.onNavigate({
        bucketName: "bucket-a",
        prefix: "reports/",
      });
    });
    expect(runtimeOptions.setPrefix).toHaveBeenCalledWith("reports/");
    expect(runtimeOptions.clearActiveItem).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    act(() => {
      navigationOptions.onNavigate({
        bucketName: "bucket-b",
        prefix: "other/",
      });
    });
    expect(runtimeOptions.setPrefix).not.toHaveBeenCalled();
    expect(runtimeOptions.clearActiveItem).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mocks.hasOpenModal.mockReturnValue(true);
    expect(
      navigationOptions.onNavigate({
        bucketName: "bucket-a",
        prefix: "",
      }),
    ).toBe(false);
    expect(runtimeOptions.requestTransition).not.toHaveBeenCalled();
  });
});
