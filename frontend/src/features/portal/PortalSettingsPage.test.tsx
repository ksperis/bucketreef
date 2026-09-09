import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalProjectSettings } from "../../api/portalAccounts";
import { LanguageProvider } from "../../components/language";
import { setSessionUserCache } from "../../utils/workspaces";
import PortalSettingsPage from "./PortalSettingsPage";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  save: vi.fn(),
  context: {
    selectedAccount: {
      id: 101,
      name: "Research",
      storage_endpoint_name: "Ceph EU",
    },
    selectedAccountId: "101",
    loading: false,
  },
}));
vi.mock("../../api/portalAccounts", () => ({
  fetchPortalProjectSettings: (...args: unknown[]) => mocks.fetch(...args),
  updatePortalProjectSettings: (...args: unknown[]) => mocks.save(...args),
}));
vi.mock("./PortalAccountContext", () => ({
  usePortalAccountContext: () => mocks.context,
}));
const project: PortalProjectSettings = {
  effective: {
    browser_access_enabled: true,
    allow_private_storage_space_create: true,
    allow_portal_named_bucket_create: false,
    allow_portal_user_access_key_create: true,
    server_access_logging_enabled: true,
    server_access_log_retention_days: 30,
    storage_space_version_cleanup_enabled: true,
    max_portal_user_access_keys: 2,
    bucket_defaults: {
      versioning: true,
      enable_lifecycle: true,
      noncurrent_version_expiration_days: 90,
      enable_cors: false,
      cors_allowed_origins: ["https://portal.example.test"],
    },
  },
  project_override: {},
  delegated_to_portal_managers: true,
  can_update: true,
};
describe("Portal project settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSessionUserCache(null);
    localStorage.clear();
    mocks.context.selectedAccountId = "101";
    mocks.fetch.mockResolvedValue(project);
    mocks.save.mockImplementation(async (_id, payload) => ({
      ...project,
      project_override: payload,
    }));
  });
  it.each([false, true])(
    "shows effective values and the read-only reason (delegation=%s)",
    async (delegated) => {
      mocks.fetch.mockResolvedValue({
        ...project,
        can_update: false,
        delegated_to_portal_managers: delegated,
      });
      render(<PortalSettingsPage />);
      expect(
        await screen.findByText(
          delegated
            ? "Only delegated project managers can edit these settings."
            : "Project settings are managed by the platform administrator.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Research")).toBeInTheDocument();
      expect(screen.getByText("Ceph EU")).toBeInTheDocument();
      expect(screen.getAllByText("Platform").length).toBeGreaterThan(0);
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Save changes" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Storage used")).not.toBeInTheDocument();
    },
  );
  it("keeps a draft when delegation is revoked and reloads current values on confirmed cancellation", async () => {
    render(<PortalSettingsPage />);
    fireEvent.change(await screen.findByLabelText("Browser workspace access"), { target: { value: "disabled" } });
    mocks.fetch.mockResolvedValue({ ...project, can_update: false, delegated_to_portal_managers: false });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/Your settings access has changed/);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getByText("Project settings are managed by the platform administrator.")).toBeInTheDocument();
  });

  it("saves a change and restores inheritance only after confirmation and Save", async () => {
    const initial = {
      ...project,
      project_override: { browser_access_enabled: true },
    };
    mocks.fetch.mockResolvedValue(initial);
    render(<PortalSettingsPage />);
    fireEvent.change(await screen.findByLabelText("Browser workspace access"), {
      target: { value: "disabled" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith("101", {
        browser_access_enabled: false,
      }),
    );
    mocks.fetch.mockResolvedValue({
      ...project,
      project_override: { browser_access_enabled: false },
    });
    await screen.findByText("Project settings saved.");
    fireEvent.click(
      screen.getByRole("button", { name: "Restore platform values" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Apply" }),
    );
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Browser workspace access")).toHaveValue(
      "inherit",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.save).toHaveBeenLastCalledWith("101", {}));
  });
  it("cancels drafts and validates an empty customized number without clamping it", async () => {
    render(<PortalSettingsPage />);
    fireEvent.click(
      await screen.findByRole("switch", {
        name: "Customize — Version history retention",
      }),
    );
    const number = screen.getByRole("spinbutton", {
      name: "Version history retention",
    });
    fireEvent.change(number, { target: { value: "" } });
    expect(number).toHaveValue(null);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText("Enter a positive whole number."),
    ).toBeInTheDocument();
    await waitFor(() => expect(number).toHaveFocus());
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(
      screen.getByRole("switch", {
        name: "Customize — Version history retention",
      }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
  });
  it("keeps CORS dialog edits local until Apply and keeps the page draft on failure", async () => {
    render(<PortalSettingsPage />);
    fireEvent.click(
      await screen.findByRole("switch", { name: "Customize — CORS origins" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    fireEvent.change(screen.getByRole("textbox", { name: "CORS origins" }), {
      target: { value: "https://draft.test" },
    });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    expect(screen.getByRole("textbox", { name: "CORS origins" })).toHaveValue(
      "https://portal.example.test",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "CORS origins" }), {
      target: { value: "https://applied.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.save.mockRejectedValueOnce(new Error("network"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText(/Unable to save project settings/),
    ).toBeInTheDocument();
    expect(mocks.save).toHaveBeenLastCalledWith("101", {
      bucket_defaults: { cors_allowed_origins: ["https://applied.test"] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    expect(screen.getByRole("textbox", { name: "CORS origins" })).toHaveValue(
      "https://applied.test",
    );
  });
  it("preserves a concurrent edit and refuses conflicting changes", async () => {
    render(<PortalSettingsPage />);
    fireEvent.click(
      await screen.findByRole("switch", {
        name: "Customize — Version history retention",
      }),
    );
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "45" },
    });
    mocks.fetch.mockResolvedValue({
      ...project,
      project_override: {
        bucket_defaults: { noncurrent_version_expiration_days: 30 },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText(/A setting you edited has changed on the server/),
    ).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByRole("spinbutton")).toHaveValue(45);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("spinbutton")).toHaveValue(30);
  });
  it("ignores a late response from a previously selected project", async () => {
    let resolve!: (value: PortalProjectSettings) => void;
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise<PortalProjectSettings>((done) => {
          resolve = done;
        }),
    );
    const { rerender } = render(<PortalSettingsPage />);
    mocks.context.selectedAccountId = "202";
    rerender(<PortalSettingsPage />);
    expect(
      await screen.findByLabelText("Browser workspace access"),
    ).toHaveValue("inherit");
    await act(async () =>
      resolve({
        ...project,
        project_override: { browser_access_enabled: false },
      }),
    );
    expect(screen.getByLabelText("Browser workspace access")).toHaveValue(
      "inherit",
    );
  });
  it.each([
    [
      "en",
      "Settings",
      "Customize — CORS origins",
      "Configure",
      "One origin per line, or * for all origins.",
      "Currently applied: 90 days",
    ],
    [
      "fr",
      "Paramètres",
      "Personnaliser — Origines CORS",
      "Configurer",
      "Une origine par ligne, ou * pour toutes les origines.",
      "Actuellement appliqué : 90 jours",
    ],
    [
      "de",
      "Einstellungen",
      "Anpassen — CORS-Ursprünge",
      "Konfigurieren",
      "Ein Ursprung pro Zeile oder * für alle Ursprünge.",
      "Derzeit angewendet: 90 Tage",
    ],
  ])(
    "translates Portal and its dialog in %s",
    async (locale, title, customize, configure, help, days) => {
      setSessionUserCache({ id: 1, ui_language: locale as "en" | "fr" | "de" });
      render(
        <LanguageProvider>
          <PortalSettingsPage />
        </LanguageProvider>,
      );
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
      fireEvent.click(await screen.findByRole("switch", { name: customize }));
      fireEvent.click(screen.getByRole("button", { name: configure }));
      expect(screen.getByText(help)).toBeInTheDocument();
      expect(
        screen.getByText(days.replace("appliqué :", "appliqué:")),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("One origin per line", { exact: true }),
      ).not.toBeInTheDocument();
    },
  );
});
