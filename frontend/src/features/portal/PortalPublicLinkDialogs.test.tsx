/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../components/language";
import { setSessionUserCache } from "../../utils/workspaces";
import PortalPublicLinkCreateDialog from "./PortalPublicLinkCreateDialog";
import PortalPublicLinkRevokeDialog from "./PortalPublicLinkRevokeDialog";

const link = {
  id: 1, storage_space_id: "space-1", storage_space_name: "Research data",
  object_key: "reports/report.csv", object_name: "report.csv",
  url: "https://storage.example.test/public-links/example",
  created_at: "2026-09-10T10:00:00Z", expires_at: null, status: "Active",
};
const cases = [
  { language: "en", close: "Close", cancel: "Cancel", progress: "Revoking...", impact: "Impact" },
  { language: "fr", close: "Fermer", cancel: "Annuler", progress: "Révocation...", impact: "Conséquences" },
  { language: "de", close: "Schließen", cancel: "Abbrechen", progress: "Wird widerrufen...", impact: "Auswirkungen" },
] as const;

afterEach(() => { cleanup(); setSessionUserCache(null); localStorage.clear(); });

describe.each(cases)("Portal public link dialogs in $language", ({ language, close, cancel, progress, impact }) => {
  it("names its close action in the selected language without creating a link", () => {
    setSessionUserCache({ role: "ui_user", authType: "password", ui_language: language });
    const onClose = vi.fn();
    const onCreate = vi.fn();
    render(<LanguageProvider>
      <PortalPublicLinkCreateDialog fileName={link.object_name} path={link.object_key}
        spaceName={link.storage_space_name} expiration="" busy={false} canCreate
        onExpirationChange={vi.fn()} onClose={onClose} onCreate={onCreate} />
    </LanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: close, exact: true }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("translates secondary labels and keeps revocation unavailable while processing", () => {
    setSessionUserCache({ role: "ui_user", authType: "password", ui_language: language });
    const onConfirm = vi.fn();
    render(<LanguageProvider>
      <PortalPublicLinkRevokeDialog link={link} loading onCancel={vi.fn()} onConfirm={onConfirm} />
    </LanguageProvider>);
    expect(screen.getByRole("button", { name: close, exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: cancel, exact: true })).toBeDisabled();
    expect(screen.getByRole("button", { name: progress, exact: true })).toBeDisabled();
    expect(screen.getByText(impact, { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: progress, exact: true }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
