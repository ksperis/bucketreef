import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { SidebarSection } from "../../components/Sidebar";
import StorageOpsLayout from "./StorageOpsLayout";

let capturedNavSections: SidebarSection[] = [];

vi.mock("../../components/Layout", () => ({
  default: ({ navSections }: { navSections?: SidebarSection[] }) => {
    capturedNavSections = navSections ?? [];
    return <div />;
  },
}));

describe("StorageOpsLayout", () => {
  it("keeps Dashboard ungrouped above Operations", () => {
    render(
      <MemoryRouter initialEntries={["/storage-ops"]}>
        <StorageOpsLayout />
      </MemoryRouter>
    );

    expect(capturedNavSections.map((section) => section.label)).toEqual([undefined, "Operations"]);
    expect(capturedNavSections[0]?.links.map((link) => link.label)).toEqual(["Dashboard"]);
    expect(capturedNavSections[0]?.links[0]?.iconName).toBe("home");
    expect(capturedNavSections[1]?.links.map((link) => link.label)).toEqual(["Buckets"]);
  });
});
