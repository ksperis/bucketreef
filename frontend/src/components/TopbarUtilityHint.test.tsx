import { fireEvent, render, screen } from "@testing-library/react";
import TopbarUtilityHint from "./TopbarUtilityHint";
import UiDrawer from "./ui/UiDrawer";

describe("TopbarUtilityHint", () => {
  it("escapes the topbar stacking context and consumes Escape before the underlying drawer", () => {
    const onClose = vi.fn();
    const { container } = render(<>
      <TopbarUtilityHint label="Switch theme"><button>Theme</button></TopbarUtilityHint>
      <UiDrawer modal={false} workspace ariaLabelledBy="title" onClose={onClose}>
        <h2 id="title">Object</h2>
      </UiDrawer>
    </>);
    const trigger = screen.getByRole("button", { name: "Theme" });
    fireEvent.focus(trigger);
    const hint = screen.getByText("Switch theme");
    expect(container).not.toContainElement(hint);
    expect(document.body).toContainElement(hint);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByText("Switch theme")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
