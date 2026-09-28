import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { ApiError } from "../../api/client";
import ErrorState from "./ErrorState";
import { WorkspaceErrorContext } from "./WorkspaceErrorContext";
import { LanguageProvider } from "../language";
import { CLIENT_STORAGE_KEYS } from "../../utils/clientStorage";
import { setSessionUserCache } from "../../utils/workspaces";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("ErrorState", () => {
  it("keeps diagnostics collapsed and never renders or copies secrets", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const error = new ApiError("Bearer secret-stack", { response: { status: 503, headers: { "x-request-id": "request-1234" }, data: { detail: "password=secret-password" } } });
    const { container } = render(<MemoryRouter><ErrorState error={error} /></MemoryRouter>);
    expect(screen.getByRole("heading")).toHaveTextContent("A small setback under the sea.");
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(container).not.toHaveTextContent("secret-stack");
    expect(container).not.toHaveTextContent("secret-password");
    fireEvent.click(screen.getByText("Technical details"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy details" })); });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("HTTP: 503"));
    expect(writeText.mock.calls[0][0]).not.toContain("secret");
    expect(screen.getByRole("status")).toHaveTextContent("Details copied");
    vi.unstubAllGlobals();
  });
  it("retains its workspace and offers a local home without nesting main", () => {
    const { container } = render(<MemoryRouter><main><WorkspaceErrorContext.Provider value="/portal"><ErrorState kind="not_found" /></WorkspaceErrorContext.Provider></main></MemoryRouter>);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelector(".error-state--embedded")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to workspace" })).toHaveAttribute("href", "/portal");
  });
  it("honors Retry-After without automatically repeating any operation", async () => {
    vi.useFakeTimers();
    const retry = vi.fn();
    const error = new ApiError("limit", { response: { status: 429, headers: { "retry-after": "2" }, data: {} } });
    render(<MemoryRouter><ErrorState error={error} onRetry={retry} /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(retry).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it("renders the chosen French copy and passes a11y", async () => {
    setSessionUserCache(null);
    localStorage.setItem(CLIENT_STORAGE_KEYS.languagePreference, "fr");
    const { container } = render(<LanguageProvider><MemoryRouter><ErrorState kind="not_found" /></MemoryRouter></LanguageProvider>);
    expect(screen.getByRole("heading")).toHaveTextContent("Cette page a pris le large.");
    expect(await axe(container)).toHaveNoViolations();
  });
});
