import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BrowserNoticesPanel from "./BrowserNoticesPanel";

describe("BrowserNoticesPanel", () => {
  it("collapses persistent transfer information on mobile", () => {
    render(
      <BrowserNoticesPanel
        bucketError={null}
        statusMessage={null}
        corsInformation="Direct download/upload is not allowed on this bucket."
        warnings={[]}
        mobileViewport
        compactTransferStatus="Proxy"
        hasCorsAction={false}
        corsActionTriggerRef={createRef<HTMLButtonElement>()}
        corsActionPopoverRef={createRef<HTMLDivElement>()}
        showCorsActionPopover={false}
        toggleCorsActionPopover={vi.fn()}
        uiOrigin="https://bucketreef.example"
        corsFixing={false}
        onEnsureCors={vi.fn()}
      />,
    );

    const summary = screen.getByText("Transfers · Proxy");
    expect(summary.closest("summary")).toHaveClass("min-h-[44px]");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(
      screen.getByText("Direct download/upload is not allowed on this bucket."),
    ).toBeInTheDocument();
  });
});
