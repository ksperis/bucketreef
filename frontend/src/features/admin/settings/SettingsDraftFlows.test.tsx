import { ThemeProvider } from "../../../components/theme";
import { transferableAbortController } from "node:util";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../../api/appSettings";
import { createAppSettings } from "./settingsTestFixtures";
import GeneralSettingsPage from "../GeneralSettingsPage";
import BrowserSettingsPage from "../BrowserSettingsPage";
import ManagerSettingsPage from "../ManagerSettingsPage";
import PortalSettingsPage from "../PortalSettingsPage";
import AuthenticationSettingsPage from "../AuthenticationSettingsPage";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  defaults: vi.fn(),
  save: vi.fn(),
  branding: vi.fn(),
}));
vi.mock("../../../api/appSettings", () => ({
  fetchAppSettings: () => mocks.fetch(),
  fetchDefaultAppSettings: () => mocks.defaults(),
  updateAppSettings: (value: AppSettings) => mocks.save(value),
  fetchGeneralFeatureLocks: async () => ({}),
  sendQuotaNotificationTestEmail: vi.fn(),
}));
vi.mock("../../../api/authSettings", () => ({
  fetchOidcAdminProviders: async () => [],
  fetchLdapAdminProviders: async () => [],
}));
vi.mock("../../../components/ui/brandingRuntime", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  applyBranding: mocks.branding,
}));
vi.mock("../../../utils/workspaces", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readStoredUser: () => ({ id: 1 }),
}));
const pages = [
  ["General", GeneralSettingsPage, "Browser feature"],
  ["Browser", BrowserSettingsPage, "Enable Browser in Portal Storage Spaces"],
  ["Manager", ManagerSettingsPage, "Bucket quota management"],
  ["Portal", PortalSettingsPage, "Portal Browser workspace access"],
  ["Authentication", AuthenticationSettingsPage, "Access-key login"],
] as const;
function mount(Page: typeof GeneralSettingsPage) {
  const router = createMemoryRouter(
    [
      {
        path: "/settings",
        element: (
          <ThemeProvider>
            <Page />
          </ThemeProvider>
        ),
      },
      { path: "/other", element: <p>Other page</p> },
    ],
    { initialEntries: ["/settings"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}
describe("shared settings draft flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("AbortController", function () {
      return transferableAbortController();
    });
    mocks.fetch.mockResolvedValue(createAppSettings());
    mocks.defaults.mockResolvedValue(createAppSettings());
    mocks.save.mockImplementation(async (value) => value);
  });
  it.each(pages)(
    "%s: cancel, failure retention, retry, route and unload protection",
    async (_name, Page, label) => {
      const router = mount(Page);
      const toggle = await screen.findByRole("switch", { name: label });
      await waitFor(() => expect(toggle).toBeEnabled());
      const initial = (toggle as HTMLInputElement).checked;
      expect(
        screen.queryByRole("button", { name: "Save changes" }),
      ).not.toBeInTheDocument();
      fireEvent.click(toggle);
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
      await act(async () => {
        void router.navigate("/other");
      });
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      expect(router.state.location.pathname).toBe("/settings");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
      expect((toggle as HTMLInputElement).checked).toBe(initial);
      expect(mocks.save).not.toHaveBeenCalled();
      fireEvent.click(toggle);
      mocks.save.mockRejectedValueOnce(new Error("Network Error"));
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      expect(
        await screen.findByText("Unable to save settings."),
      ).toBeInTheDocument();
      expect((toggle as HTMLInputElement).checked).toBe(!initial);
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await screen.findByText("Settings saved.");
      expect(mocks.save).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByRole("button", { name: "Save changes" }),
      ).not.toBeInTheDocument();
      await act(async () => {
        await router.navigate("/other");
      });
      expect(screen.getByText("Other page")).toBeInTheDocument();
    },
  );
  it("keeps migration numbers empty while editing, validates dependencies and applies only to the page draft", async () => {
    mount(ManagerSettingsPage);
    fireEvent.click(
      await screen.findByRole("button", { name: "Configure migration" }),
    );
    const dialog = screen.getByRole("dialog");
    const fields = within(dialog).getAllByRole("spinbutton");
    fireEvent.change(fields[0], { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(fields[0]).toHaveValue(null);
    expect(fields[0]).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(fields[0], { target: { value: "64" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(fields[0]).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(fields[0], { target: { value: "4" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(
      mocks.save.mock.calls[0][0].manager.bucket_migration_parallelism_default,
    ).toBe(4);
  });
  it("preserves concurrent server fields and surfaces a conflict next to the modified input", async () => {
    mount(BrowserSettingsPage);
    const input = await screen.findByRole("spinbutton", {
      name: "Direct uploads",
    });
    fireEvent.change(input, { target: { value: "8" } });
    const latest = createAppSettings();
    latest.browser.direct_upload_parallelism = 6;
    mocks.fetch.mockResolvedValue(latest);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText(
        "Changed on the server. Cancel to load the current value.",
      ),
    ).toBeInTheDocument();
    expect(input).toHaveValue(8);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
