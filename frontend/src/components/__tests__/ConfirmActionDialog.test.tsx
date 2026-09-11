import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { axe } from "jest-axe";
import ConfirmActionDialog from "../ConfirmActionDialog";

describe("ConfirmActionDialog", () => {
  it("keeps a failed action visible in the open confirmation", () => {
    render(<ConfirmActionDialog title="Revoke identity" description="Review the selected identity."
      confirmLabel="Revoke" error="Unable to revoke this identity." onCancel={() => undefined} onConfirm={() => undefined} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to revoke this identity.");
    expect(screen.getByRole("button", { name: "Revoke" })).toBeEnabled();
  });

  it("renders details and triggers callbacks", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmActionDialog
        title="Delete user"
        description="This action removes the UI user and its assignments."
        confirmLabel="Delete user"
        details={[
          { label: "Target", value: "ops@example.com" },
          { label: "Scope", value: "Admin", mono: true },
        ]}
        impacts={["Access to linked workspaces is removed."]}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole("dialog", { name: "Delete user" })).toBeInTheDocument();
    expect(screen.getByText("ops@example.com")).toBeInTheDocument();
    expect(screen.getByText("Access to linked workspaces is removed.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete user" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});


it.each(["close", "cancel", "escape", "backdrop"])("blocks %s dismissal only while confirmation is pending", (action) => {
  const onCancel = vi.fn(), onConfirm = vi.fn();
  const props = { title: "Delete resource?", description: "Review this deletion.", confirmLabel: "Delete resource", onCancel, onConfirm };
  const { rerender } = render(<ConfirmActionDialog {...props} loading />);
  const dismiss = () => {
    if (action === "close") fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    else if (action === "cancel") fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    else if (action === "escape") fireEvent.keyDown(document, { key: "Escape" });
    else fireEvent.mouseDown(screen.getByRole("presentation"));
  };
  expect(screen.getByRole("button", { name: "Close modal" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Processing..." })).toBeDisabled();
  dismiss();
  fireEvent.click(screen.getByRole("button", { name: "Processing..." }));
  expect(onCancel).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
  rerender(<ConfirmActionDialog {...props} loading={false} />);
  dismiss();
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it("keeps a disabled confirmation cancellable and preserves translated copy", async () => {
  const user = userEvent.setup(), onCancel = vi.fn(), onConfirm = vi.fn();
  const props = { title: "Supprimer cette ressource ?", description: "Vérifiez la ressource sélectionnée.", confirmLabel: "Supprimer",
    cancelLabel: "Conserver", closeLabel: "Fermer", impactLabel: "Conséquences", processingLabel: "Traitement…",
    onCancel, onConfirm, warning: <span>Cette opération est définitive.</span>, impacts: ["L’accès sera supprimé."] };
  const { rerender } = render(<ConfirmActionDialog {...props} confirmDisabled />);
  expect(screen.getByRole("dialog")).toHaveAccessibleDescription("Vérifiez la ressource sélectionnée.");
  expect(screen.getByText("Conséquences")).toBeInTheDocument();
  expect(screen.getByText("Cette opération est définitive.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Supprimer" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Fermer" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
  rerender(<ConfirmActionDialog {...props} loading />);
  expect(screen.getByRole("button", { name: "Traitement…" })).toBeDisabled();
});

it("retains accessible resource details and descriptions [a11y]", async () => {
  const { container } = render(<ConfirmActionDialog title="Delete policy?" description="Review the policy before deleting it."
    confirmLabel="Delete policy" details={[{ label: "Policy", value: "operations-policy" }, { label: "ARN", value: "arn:aws:iam::fixture:policy/operations-policy", mono: true }]}
    impacts={["Policy permissions will no longer apply."]} onCancel={() => undefined} onConfirm={() => undefined} />);
  expect(screen.getByRole("dialog")).toHaveAccessibleDescription("Review the policy before deleting it.");
  expect(await axe(container)).toHaveNoViolations();
});
