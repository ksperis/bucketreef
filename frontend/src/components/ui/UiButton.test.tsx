import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import UiButton, { UiButtonLink } from "./UiButton";
import UiIconButton from "./UiIconButton";

describe("UiButton", () => {
  it("applies shared size and variant classes", () => {
    render(
      <UiButton variant="secondary" size="sm">
        Save
      </UiButton>
    );

    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("ui-button-secondary", "h-8");
  });

  it("disables the button while loading", () => {
    render(<UiButton loading>Saving</UiButton>);

    expect(screen.getByRole("button", { name: "Saving" })).toBeDisabled();
  });

  it("uses the same shared presentation for navigation actions", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <UiButtonLink to="/next" variant="secondary" size="sm" disabled>
          Open
        </UiButtonLink>
      </MemoryRouter>
    );

    const link = screen.getByRole("link", { name: "Open" });
    expect(link).toHaveClass("ui-button-base", "ui-button-secondary", "h-8");
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("tabindex", "-1");
    await user.click(link);
    expect(link).toHaveAttribute("href", "/next");
  });
});

describe("UiIconButton", () => {
  it("requires an accessible label for icon-only actions", () => {
    render(<UiIconButton label="Refresh list" icon="R" size="compact" />);

    expect(screen.getByRole("button", { name: "Refresh list" })).toHaveClass("h-6", "w-6");
  });
});
