/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider, useLanguage, type UiLanguage } from "../../components/language";
import { BrowserDirectItemActionButton } from "./BrowserActionPresentation";
import { BrowserObjectFactsSection } from "./BrowserObjectReadOnlyDetailsTab";
import { BrowserObjectColumnValue } from "./BrowserObjectTablePresentation";
import type { BrowserItem } from "./browserTypes";
import { formatDateTime, formatLocalDateTime } from "./browserUtils";
import { formatBytes } from "../../utils/format";

const item: BrowserItem = {
  id: "report", key: "reports/Size.txt", name: "Size.txt", type: "file",
  size: "1.5 KB", sizeBytes: 1536, modified: "2026-10-11 10:00",
  modifiedAt: Date.parse("2026-10-11T10:00:00Z"), owner: "Owner",
};

function LanguageControls() {
  const { setLanguage } = useLanguage();
  return <>{(["en", "fr", "de", "zh"] as UiLanguage[]).map((locale) => (
    <button key={locale} onClick={() => setLanguage(locale)}>{locale}</button>
  ))}</>;
}

describe("Browser locale changes", () => {
  it("updates object labels, accessible actions and formats without translating resource values", async () => {
    render(<LanguageProvider>
      <LanguageControls />
      <BrowserObjectFactsSection bucketName="Bucket" item={item} metadata={null} />
      <BrowserObjectColumnValue item={item} columnId="size" />
      <BrowserDirectItemActionButton
        action={{ id: "download", label: "Download", visible: true, enabled: false, disabledReason: "Wait for the current operation to finish." }}
        itemName={item.name} onSelect={vi.fn()}
      />
    </LanguageProvider>);

    for (const [locale, sizeLabel, size, action, reason] of [
      ["fr", "Taille", "1,5 KB", "Télécharger", "Attendez la fin de l'opération en cours."],
      ["de", "Größe", "1,5 KB", "Herunterladen", "Warten Sie auf den Abschluss der aktuellen Operation."],
      ["zh", "大小", "1.5 KB", "下载", "等待当前操作完成。"],
    ]) {
      fireEvent.click(screen.getByRole("button", { name: locale }));
      await waitFor(() => expect(screen.getByText(sizeLabel)).toBeInTheDocument());
      expect(screen.getAllByText(size)).toHaveLength(2);
      // A resource can have the same spelling as a translatable UI label.
      expect(screen.getByText("Bucket", { selector: "dd" })).toBeInTheDocument();
      expect(screen.getByText("Owner", { selector: "dd" })).toBeInTheDocument();
      const button = screen.getByRole("button", { name: new RegExp(`${action}.*Size\\.txt|Size\\.txt.*${action}`) });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", reason);
    }
  });

  it("keeps date input and default formatter contracts while localizing display values", () => {
    const date = "2026-10-11T10:00:00Z";
    expect(formatDateTime(date, "fr-FR")).toMatch(/^11\/10\/2026/);
    expect(formatDateTime(date, "de-DE")).toMatch(/^11\.10\.2026/);
    expect(formatDateTime(date, "zh-CN")).toMatch(/^2026\/10\/11/);
    expect(formatDateTime(date)).toMatch(/^2026-10-11 /);
    expect(formatDateTime(0, "fr-FR")).not.toBe("-");
    expect(formatDateTime("invalid", "fr-FR")).toBe("invalid");
    expect(formatLocalDateTime(date)).toMatch(/^2026-10-11T\d{2}:\d{2}$/);
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1536, "fr-FR")).toBe("1,5 KB");
  });
});
