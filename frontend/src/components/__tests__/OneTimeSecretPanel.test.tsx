/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OneTimeSecretPanel from "../OneTimeSecretPanel";
import { copyTextToClipboard } from "../../utils/clipboard";

vi.mock("../../utils/clipboard", () => ({ copyTextToClipboard: vi.fn() }));
const copy = vi.mocked(copyTextToClipboard);
const fields = [
  { label: "Access key", value: "EXAMPLE-ACCESS", copyLabel: "Copy" },
  { label: "Secret key", value: "  EXAMPLE-only/+\nsecret=  ", copyLabel: "Copy" },
];
const props = { title: "Key created", description: "Store these values now.", values: fields };

describe("OneTimeSecretPanel", () => {
  beforeEach(() => { copy.mockReset().mockResolvedValue(); });

  it("labels each copy action and copies the exact selected value with local feedback", async () => {
    const { container } = render(<OneTimeSecretPanel {...props} badge="One-time display" />);
    const secret = screen.getByRole("group", { name: "Secret key" });
    expect(within(secret).getByRole("button", { name: "Copy" })).toHaveAccessibleDescription("Secret key");
    expect(secret.querySelector("code")?.textContent).toBe(fields[1].value);
    fireEvent.click(within(secret).getByRole("button", { name: "Copy" }));
    expect(await within(secret).findByRole("status")).toHaveTextContent("Copied to clipboard.");
    expect(copy).toHaveBeenCalledWith(fields[1].value);
    expect(within(screen.getByRole("group", { name: "Access key" })).queryByRole("status")).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows a recoverable copy failure without exposing exception details and permits retry", async () => {
    copy.mockRejectedValueOnce(new Error("Clipboard implementation details"));
    render(<OneTimeSecretPanel {...props} />);
    const access = within(screen.getByRole("group", { name: "Access key" }));
    fireEvent.click(access.getByRole("button"));
    expect(await access.findByRole("alert")).toHaveTextContent("Unable to copy. Select and copy this value manually.");
    expect(screen.queryByText("Clipboard implementation details")).not.toBeInTheDocument();
    expect(access.getByText("EXAMPLE-ACCESS")).toBeInTheDocument();
    fireEvent.click(access.getByRole("button"));
    expect(await access.findByRole("status")).toHaveTextContent("Copied to clipboard.");
    expect(access.queryByRole("alert")).not.toBeInTheDocument();
    expect(copy.mock.calls).toEqual([["EXAMPLE-ACCESS"], ["EXAMPLE-ACCESS"]]);
  });

  it("prevents duplicate copying and ignores completion for a replaced value", async () => {
    let complete!: () => void;
    copy.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; }));
    const { rerender } = render(<OneTimeSecretPanel {...props} values={[fields[0]]} />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(copy).toHaveBeenCalledOnce();
    rerender(<OneTimeSecretPanel {...props} values={[{ ...fields[0], value: "REPLACEMENT-EXAMPLE" }]} />);
    expect(button).toBeEnabled();
    await act(async () => complete());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(await screen.findByRole("status")).toHaveTextContent("Copied to clipboard.");
    expect(copy).toHaveBeenLastCalledWith("REPLACEMENT-EXAMPLE");
  });

  it("uses localized copy feedback without changing caller labels or actions", async () => {
    copy.mockRejectedValueOnce(new Error("Unavailable"));
    render(<OneTimeSecretPanel {...props} values={[{ label: "Clé secrète", value: "EXEMPLE", copyLabel: "Copier" }]}
      actions={<a href="/manager/users/example/keys">Manage keys</a>}
      copyFeedback={{ copied: "Copié.", failed: "Copie impossible." }} />);
    fireEvent.click(screen.getByRole("button", { name: "Copier" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Copie impossible.");
    fireEvent.click(screen.getByRole("button", { name: "Copier" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Copié.");
    expect(screen.getByRole("link", { name: "Manage keys" })).toHaveAttribute("href", "/manager/users/example/keys");
  });

  it("keeps noncopyable values visible and disables copying an empty value", () => {
    render(<OneTimeSecretPanel {...props} values={[
      { label: "Token", value: "DISPLAY-ONLY" },
      { label: "Secret", value: "", copyLabel: "Copy" },
    ]} />);
    expect(within(screen.getByRole("group", { name: "Token" })).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    expect(screen.getByText("DISPLAY-ONLY")).toBeInTheDocument();
  });
});
