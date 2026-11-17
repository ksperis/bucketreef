import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SidebarSection } from "../../components/Sidebar";
import { LanguageProvider } from "../../components/language";
import { CLIENT_STORAGE_KEYS } from "../../utils/clientStorage";
import StorageOpsLayout from "./StorageOpsLayout";

let capturedNavSections: SidebarSection[] = [];

vi.mock("../../components/Layout", () => ({
  default: ({ navSections }: { navSections?: SidebarSection[] }) => {
    capturedNavSections = navSections ?? [];
    return <div />;
  },
}));

describe("StorageOpsLayout", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps Dashboard ungrouped above Operations", () => {
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={["/storage-ops"]}>
          <StorageOpsLayout />
        </MemoryRouter>
      </LanguageProvider>
    );

    expect(capturedNavSections.map((section) => section.label)).toEqual([undefined, "Operations"]);
    expect(capturedNavSections[0]?.links.map((link) => link.label)).toEqual(["Dashboard"]);
    expect(capturedNavSections[0]?.links[0]?.iconName).toBe("home");
    expect(capturedNavSections[1]?.links.map((link) => link.label)).toEqual(["Buckets"]);
  });

  it("localizes the Storage Ops navigation in French", () => {
    window.localStorage.setItem(CLIENT_STORAGE_KEYS.languagePreference, "fr");

    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={["/storage-ops"]}>
          <StorageOpsLayout />
        </MemoryRouter>
      </LanguageProvider>
    );

    expect(capturedNavSections.map((section) => section.label)).toEqual([undefined, "Opérations"]);
    expect(capturedNavSections[0]?.links.map((link) => link.label)).toEqual(["Tableau de bord"]);
    expect(capturedNavSections[1]?.links.map((link) => link.label)).toEqual(["Buckets"]);
  });
});
