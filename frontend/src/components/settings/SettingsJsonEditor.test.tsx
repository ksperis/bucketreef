import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import SettingsJsonEditor from "./SettingsJsonEditor";

function EditorHarness({ initial = '{"name":"demo"}' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <SettingsJsonEditor label="JSON document" value={value} onChange={setValue} rows={6} />;
}

describe("SettingsJsonEditor", () => {
  it("highlights JSON tokens and exposes a valid syntax state", () => {
    const { container } = render(
      <EditorHarness initial={'{"name":"demo","count":2,"enabled":true,"optional":null}'} />,
    );

    expect(screen.getByText("Valid JSON")).toBeInTheDocument();
    expect(container.querySelectorAll(".settings-json-token-key")).toHaveLength(4);
    expect(container.querySelector(".settings-json-token-string")).toHaveTextContent('"demo"');
    expect(container.querySelector(".settings-json-token-number")).toHaveTextContent("2");
    expect(container.querySelector(".settings-json-token-boolean")).toHaveTextContent("true");
    expect(container.querySelector(".settings-json-token-null")).toHaveTextContent("null");
  });

  it("reports syntax errors immediately while preserving the exact draft", () => {
    render(<EditorHarness />);
    const editor = screen.getByRole("textbox", { name: "JSON document" });

    fireEvent.change(editor, { target: { value: '{"name":}' } });

    expect(editor).toHaveValue('{"name":}');
    expect(editor).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/^Invalid JSON:/)).toBeInTheDocument();
    expect(screen.getByText("JSON syntax error")).toBeInTheDocument();
  });

  it("formats valid JSON with two spaces only when requested and keeps a usable caret", async () => {
    render(<EditorHarness initial={'{"name":"demo","nested":{"enabled":true}}'} />);
    const editor = screen.getByRole("textbox", { name: "JSON document" }) as HTMLTextAreaElement;

    expect(editor).toHaveValue('{"name":"demo","nested":{"enabled":true}}');
    fireEvent.click(screen.getByRole("button", { name: "Format JSON" }));

    expect(editor).toHaveValue(`{
  "name": "demo",
  "nested": {
    "enabled": true
  }
}`);
    await waitFor(() => expect(editor.selectionStart).toBe(editor.value.length));
  });

  it("indents at the caret with Tab and keeps the caret after the inserted spaces", async () => {
    render(<EditorHarness initial={'{"name":"demo"}'} />);
    const editor = screen.getByRole("textbox", { name: "JSON document" }) as HTMLTextAreaElement;
    editor.setSelectionRange(1, 1);

    fireEvent.keyDown(editor, { key: "Tab" });

    expect(editor).toHaveValue('{  "name":"demo"}');
    await waitFor(() => expect(editor.selectionStart).toBe(3));
  });

  it("indents and dedents complete selected lines", async () => {
    render(<EditorHarness initial={`{
  "name": "demo"
}`} />);
    const editor = screen.getByRole("textbox", { name: "JSON document" }) as HTMLTextAreaElement;
    editor.setSelectionRange(0, editor.value.length);

    fireEvent.keyDown(editor, { key: "Tab" });
    expect(editor).toHaveValue(`  {
    "name": "demo"
  }`);

    editor.setSelectionRange(0, editor.value.length);
    fireEvent.keyDown(editor, { key: "Tab", shiftKey: true });
    expect(editor).toHaveValue(`{
  "name": "demo"
}`);
    await waitFor(() => expect(editor.selectionStart).toBe(0));
  });

  it("keeps the highlighted layer synchronized with textarea scrolling", () => {
    const { container } = render(<EditorHarness initial={'{\n  "name": "demo"\n}'} />);
    const editor = screen.getByRole("textbox", { name: "JSON document" }) as HTMLTextAreaElement;
    const highlight = container.querySelector(".settings-json-highlight") as HTMLPreElement;
    editor.scrollTop = 24;
    editor.scrollLeft = 8;

    fireEvent.scroll(editor);

    expect(highlight.scrollTop).toBe(24);
    expect(highlight.scrollLeft).toBe(8);
  });

  it("treats an empty document neutrally and preserves disabled/read-only contracts", () => {
    const { rerender } = render(
      <SettingsJsonEditor label="JSON document" value="" onChange={() => {}} hint="Optional JSON" disabled />,
    );
    const disabledEditor = screen.getByRole("textbox", { name: "JSON document" });
    expect(disabledEditor).toBeDisabled();
    expect(disabledEditor).toHaveAccessibleDescription("Optional JSON");
    expect(screen.getByText("Empty JSON document")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Format JSON" })).toBeDisabled();

    rerender(<SettingsJsonEditor label="JSON document" value="{}" readOnly />);
    expect(screen.getByRole("textbox", { name: "JSON document" })).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Format JSON" })).not.toBeInTheDocument();
  });
});
