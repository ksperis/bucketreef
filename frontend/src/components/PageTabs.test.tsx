/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import PageTabs, { PageTabPanel } from "./PageTabs";

function SemanticTabs({ variant }: { variant: "bar" | "line" | "card" }) {
  const [activeTab, setActiveTab] = useState("connection");
  return (
    <>
      <PageTabs
        tabs={[
          { id: "connection", label: "Connection" },
          { id: "disabled", label: "Disabled", disabled: true },
          { id: "credentials", label: "Credentials" },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
        ariaLabel="Endpoint sections"
        idPrefix="endpoint-editor"
        variant={variant}
      />
      <PageTabPanel idPrefix="endpoint-editor" tabId={activeTab}>
        {activeTab === "connection" ? "Connection panel" : "Credentials panel"}
      </PageTabPanel>
    </>
  );
}

describe("PageTabs", () => {
  it.each(["bar", "line", "card"] as const)("links %s tabs to their panels and supports keyboard navigation", variant => {
    render(<SemanticTabs variant={variant} />);

    const connectionTab = screen.getByRole("tab", { name: "Connection" });
    expect(connectionTab).toHaveAttribute("id", "endpoint-editor-tab-connection");
    expect(connectionTab).toHaveAttribute("aria-controls", "endpoint-editor-panel-connection");
    expect(connectionTab).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "endpoint-editor-tab-connection",
    );

    fireEvent.keyDown(connectionTab, { key: "ArrowRight" });

    const credentialsTab = screen.getByRole("tab", { name: "Credentials" });
    expect(credentialsTab).toHaveAttribute("aria-selected", "true");
    expect(credentialsTab).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "id",
      "endpoint-editor-panel-credentials",
    );
    expect(screen.getByRole("tab", { name: "Disabled" })).toBeDisabled();
    fireEvent.keyDown(credentialsTab, { key: "Home" });
    expect(connectionTab).toHaveFocus();
    expect(connectionTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(connectionTab, { key: "End" });
    expect(credentialsTab).toHaveFocus();
    fireEvent.keyDown(credentialsTab, { key: "ArrowLeft" });
    expect(connectionTab).toHaveFocus();
  });

  it("renders content below bar tabs without adding a card frame", () => {
    render(
      <PageTabs
        tabs={[
          { id: "general", label: "General", content: <p>General settings</p> },
          { id: "access", label: "Access", content: <p>Access settings</p> },
        ]}
        activeTab="general"
        onChange={() => undefined}
        ariaLabel="Editor sections"
        idPrefix="editor"
        variant="bar"
      />
    );

    expect(screen.getByRole("tabpanel")).toHaveTextContent("General settings");
    expect(screen.getByRole("tabpanel")).toHaveClass("mt-4");
    expect(screen.getByRole("tabpanel").parentElement).not.toHaveClass("ui-surface-card");
  });

  it("keeps tabs semantic and keyboard accessible without optional accessibility props", () => {
    function GeneratedTabs() {
      const [activeTab, setActiveTab] = useState("general");
      return (
        <PageTabs
          tabs={[
            { id: "general", label: "General", content: <p>General settings</p> },
            { id: "advanced", label: "Advanced", content: <p>Advanced settings</p> },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
          variant="bar"
        />
      );
    }

    render(<GeneratedTabs />);

    const tabList = screen.getByRole("tablist");
    const generalTab = screen.getByRole("tab", { name: "General" });
    const advancedTab = screen.getByRole("tab", { name: "Advanced" });
    const generalPanel = screen.getByRole("tabpanel");

    expect(tabList).not.toHaveAttribute("aria-label");
    expect(generalTab).toHaveAttribute("tabindex", "0");
    expect(advancedTab).toHaveAttribute("tabindex", "-1");
    expect(generalTab.id).not.toBe("");
    expect(generalPanel.id).not.toBe("");
    expect(generalTab).toHaveAttribute("aria-controls", generalPanel.id);
    expect(generalPanel).toHaveAttribute("aria-labelledby", generalTab.id);

    fireEvent.keyDown(generalTab, { key: "ArrowRight" });

    const advancedPanel = screen.getByRole("tabpanel");
    expect(advancedTab).toHaveFocus();
    expect(advancedTab).toHaveAttribute("aria-selected", "true");
    expect(advancedTab).toHaveAttribute("tabindex", "0");
    expect(advancedPanel).toHaveTextContent("Advanced settings");
    expect(advancedTab).toHaveAttribute("aria-controls", advancedPanel.id);
    expect(advancedPanel).toHaveAttribute("aria-labelledby", advancedTab.id);
  });

  it("owns the shared baseline for top-level page tabs", () => {
    const { container } = render(
      <PageTabs
        tabs={[{ id: "general", label: "General" }]}
        activeTab="general"
        onChange={() => undefined}
        variant="line"
      />
    );

    expect(container.firstElementChild).toHaveClass("border-b");
    expect(container.firstElementChild).toHaveClass("border-[color:var(--ui-border-soft)]");
    expect(screen.getByRole("tab", { name: "General" })).not.toHaveAttribute("aria-controls");
    expect(screen.getByText("General").parentElement).toHaveClass("min-w-0", "flex-1", "flex-wrap");
  });
});
