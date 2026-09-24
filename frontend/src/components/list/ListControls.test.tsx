import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { axe } from "jest-axe";
import {
  ListActionButton,
  ListActionLink,
  ListActions,
  ListBadge,
  ListSelectionCheckbox,
} from "./ListControls";

describe("listing actions", () => {
  it("supports keyboard activation and refs without accidentally submitting a containing form", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    const submit = vi.fn((event) => event.preventDefault());
    const ref = createRef<HTMLButtonElement>();
    render(<form onSubmit={submit}><ListActionButton ref={ref} onClick={action}>Open</ListActionButton></form>);
    await user.tab();
    expect(ref.current).toHaveFocus();
    await user.keyboard(" ");
    expect(action).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it("blocks repeat activation while a mutation is in progress", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    const { rerender } = render(<ListActionButton loading onClick={action}>Delete</ListActionButton>);
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await user.click(button);
    expect(action).not.toHaveBeenCalled();
    rerender(<ListActionButton onClick={action}>Delete</ListActionButton>);
    await user.click(button);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("keeps links as links and respects an explicitly disabled action", async () => {
    const user = userEvent.setup();
    const disabledClick = vi.fn();
    render(<MemoryRouter><Routes>
      <Route path="/" element={<ListActions>
        <ListActionLink to="/edit" aria-disabled onClick={disabledClick}>Locked</ListActionLink>
        <ListActionLink to="/edit">Edit</ListActionLink>
      </ListActions>} />
      <Route path="/edit" element={<p>Editor</p>} />
    </Routes></MemoryRouter>);
    await user.click(screen.getByRole("link", { name: "Locked" }));
    expect(disabledClick).not.toHaveBeenCalled();
    expect(screen.queryByText("Editor")).not.toBeInTheDocument();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Editor")).toBeInTheDocument();
  });

  it("a11y: keeps icon names, badge descriptions and native action semantics", async () => {
    const { container } = render(<ListActions>
      <ListBadge tone="warning" title="Managed by the environment">Read only</ListBadge>
      <ListActionButton iconOnly aria-label="More actions"><span aria-hidden>…</span></ListActionButton>
      <ListActionButton variant="danger" disabled>Delete</ListActionButton>
    </ListActions>);
    expect(screen.getByTitle("Managed by the environment")).toHaveTextContent("Read only");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("normalizes list selection geometry while preserving native checkbox events and refs", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const click = vi.fn();
    const ref = createRef<HTMLInputElement>();
    render(
      <ListSelectionCheckbox
        ref={ref}
        aria-label="Select item"
        checked={false}
        onChange={change}
        onClick={click}
        touchTarget
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Select item" });
    expect(ref.current).toBe(checkbox);
    expect(checkbox).toHaveClass("h-4", "w-4");
    expect(checkbox.closest("label")).toHaveClass("ui-list-selection", "ui-list-selection-touch");
    await user.click(checkbox);
    expect(click).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledTimes(1);
  });
});
