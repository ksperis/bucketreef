/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { useConfirmActionDialog } from "./useConfirmActionDialog";

function Harness({ onConfirm }: { onConfirm: () => void | Promise<void> }) {
  const [result, setResult] = useState("idle");
  const confirmation = useConfirmActionDialog();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          confirmation.requestConfirmation({
            title: "Delete item?",
            description: "This action needs confirmation.",
            confirmLabel: "Delete item",
            details: [{ label: "Item", value: "example", mono: true }],
            impacts: ["The item will no longer be available."],
            onConfirm: async () => {
              await onConfirm();
              setResult("confirmed");
            },
          })
        }
      >
        Open confirmation
      </button>
      <span>{result}</span>
      {confirmation.confirmationDialog}
    </>
  );
}

describe("useConfirmActionDialog", () => {
  it("runs the requested action only after confirmation", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    const trigger = screen.getByRole("button", { name: "Open confirmation" });
    await user.click(trigger);
    expect(screen.getByRole("heading", { name: "Delete item?" })).toBeInTheDocument();
    expect(screen.getByText("example")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(trigger).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Delete item" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(await screen.findByText("confirmed")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Delete item?" })).not.toBeInTheDocument();
  });
});


it("runs once and keeps the dialog open until the requested operation completes", async () => {
  const user = userEvent.setup();
  let resolve!: () => void;
  const onConfirm = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
  render(<Harness onConfirm={onConfirm} />);
  const trigger = screen.getByRole("button", { name: "Open confirmation" });
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Delete item" }));
  const dialog = screen.getByRole("dialog", { name: "Delete item?" });
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Close modal" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Processing..." }));
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.mouseDown(screen.getByRole("presentation"));
  expect(dialog).toBeInTheDocument();
  expect(onConfirm).toHaveBeenCalledOnce();
  await act(async () => resolve());
  expect(await screen.findByText("confirmed")).toBeInTheDocument();
  expect(dialog).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
