import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";

describe("AdminAssociationAdvancedSettings", () => {
  it("keeps a local draft and applies the Manager Browser permission explicitly", () => {
    const onApply = vi.fn();
    render(
      <AdminAssociationAdvancedSettings
        targetLabel="Production account"
        associationKind="account"
        allowManagerBrowserDataAccess={false}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByText("Advanced association settings")).toBeInTheDocument();
    expect(screen.getByText(/same association also has the Account administrator role/)).toBeInTheDocument();
    const checkbox = screen.getByRole("switch", { name: "Allow Manager Browser data access" });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByRole("switch", { name: "Allow Manager Browser data access" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("switch", { name: "Allow Manager Browser data access" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith(true);
  });

  it("submits its draft without submitting an enclosing account form", () => {
    const parentSubmit = vi.fn(event => event.preventDefault());
    const onApply = vi.fn();
    const dirty = vi.fn();
    render(<form onSubmit={parentSubmit}><AdminAssociationAdvancedSettings targetLabel="Group"
      associationKind="rgw_user" allowManagerBrowserDataAccess={false} onApply={onApply} onDirtyChange={dirty} /></form>);
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("switch", { name: "Allow Manager Browser data access" }));
    expect(dirty).toHaveBeenLastCalledWith(true);
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(onApply).toHaveBeenCalledWith(true);
    expect(parentSubmit).not.toHaveBeenCalled();
    expect(dirty).toHaveBeenLastCalledWith(false);
  });
});
