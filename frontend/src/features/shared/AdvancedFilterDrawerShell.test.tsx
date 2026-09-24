import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import AdvancedFilterDrawerShell from "./AdvancedFilterDrawerShell";

describe("AdvancedFilterDrawerShell", () => {
  it("provides one shared dialog structure and close actions", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <AdvancedFilterDrawerShell
        title="Advanced filter"
        subtitle="Users listing"
        badges={<span>2 rules</span>}
        footer={<button type="button">Apply</button>}
        onClose={onClose}
      >
        <p>Filter fields</p>
      </AdvancedFilterDrawerShell>
    );

    expect(screen.getByRole("dialog", { name: "Advanced filter" })).toHaveTextContent("Users listing");
    expect(screen.getByText("Filter fields")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass("ui-button-base", "ui-button-secondary");
    expect(document.body.style.overflow).toBe("hidden");

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
