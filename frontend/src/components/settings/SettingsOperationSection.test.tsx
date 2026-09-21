/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import UiInput from "../ui/UiInput";
import SettingsOperationSection from "./SettingsOperationSection";

describe("SettingsOperationSection", () => {
  it("submits with Enter, freezes the entire operation until it settles and rejects duplicate submits", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const parentSubmit = vi.fn();
    render(<div onSubmit={parentSubmit}>
      <SettingsOperationSection title="Metadata" submitLabel="Save metadata" onSubmit={onSubmit}>
        <UiInput label="Content type" defaultValue="text/plain" />
      </SettingsOperationSection>
    </div>);
    await user.click(screen.getByLabelText("Content type"));
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(parentSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Content type")).toBeDisabled();
    expect(screen.getByRole("group", { name: "Metadata settings" })).toHaveAttribute("aria-busy", "true");
    fireEvent.submit(screen.getByRole("form", { name: "Metadata" }));
    expect(onSubmit).toHaveBeenCalledOnce();
    await act(async () => { finish(); });
    expect(screen.getByLabelText("Content type")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save metadata" })).toBeEnabled();
  });

  it.each(["busy", "disabled", "submitDisabled"] as const)("rejects submission when %s", (flag) => {
    const onSubmit = vi.fn();
    render(<SettingsOperationSection title="Retention" submitLabel="Update retention" onSubmit={onSubmit} {...{ [flag]: true }}>
      <UiInput label="Mode" />
    </SettingsOperationSection>);
    fireEvent.submit(screen.getByRole("form", { name: "Retention" }));
    expect(onSubmit).not.toHaveBeenCalled();
    if (flag === "submitDisabled") expect(screen.getByLabelText("Mode")).toBeEnabled();
    else expect(screen.getByLabelText("Mode")).toBeDisabled();
  });
});
