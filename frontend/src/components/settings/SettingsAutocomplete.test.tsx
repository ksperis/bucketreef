import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  SettingsAutocomplete,
  SettingsMultiValueAutocomplete,
} from "./SettingsAutocomplete";

function AutocompleteHarness({
  loadSuggestions,
}: {
  loadSuggestions?: (query: string) => Promise<Array<{ value: string; label?: string }>>;
}) {
  const [value, setValue] = useState("");
  return (
    <SettingsAutocomplete
      label="Prefix"
      value={value}
      onChange={setValue}
      suggestions={[
        { value: "logs/", description: "Logs" },
        { value: "archive/", description: "Archive" },
      ]}
      loadSuggestions={loadSuggestions}
      debounceMs={0}
    />
  );
}

describe("SettingsAutocomplete", () => {
  it("filters suggestions and supports keyboard selection with combobox semantics", async () => {
    const user = userEvent.setup();
    render(<AutocompleteHarness />);

    const input = screen.getByRole("combobox", { name: "Prefix" });
    expect(input).toHaveAttribute("aria-expanded", "false");

    await user.click(input);
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox", { name: "Suggestions" })).toBeInTheDocument();

    await user.type(input, "log");
    expect(screen.getByRole("option", { name: /logs\// })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /archive\// })).not.toBeInTheDocument();

    await user.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveValue("logs/");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("loads remote suggestions lazily and leaves failures non-blocking", async () => {
    const user = userEvent.setup();
    const loadSuggestions = vi
      .fn<(query: string) => Promise<Array<{ value: string; label?: string }>>>()
      .mockImplementation(async (query) => {
        if (query === "broken") throw new Error("boom");
        return [{ value: `${query || "root"}/remote`, label: "Remote" }];
      });
    render(<AutocompleteHarness loadSuggestions={loadSuggestions} />);

    const input = screen.getByRole("combobox", { name: "Prefix" });
    expect(loadSuggestions).not.toHaveBeenCalled();
    await user.click(input);
    await waitFor(() => expect(loadSuggestions).toHaveBeenCalledWith(""));
    expect(await screen.findByRole("option", { name: /Remote/ })).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "broken");
    await waitFor(() => expect(loadSuggestions).toHaveBeenCalledWith("broken"));
    await waitFor(() => expect(screen.queryByText("Loading suggestions...")).not.toBeInTheDocument());
    expect(input).toHaveValue("broken");
  });

  it("supports mouse selection, Tab selection and Escape dismissal", async () => {
    const user = userEvent.setup();
    render(<AutocompleteHarness />);

    const input = screen.getByRole("combobox", { name: "Prefix" });
    await user.click(input);
    await user.click(screen.getByRole("option", { name: /archive\// }));
    expect(input).toHaveValue("archive/");

    await user.click(input);
    await user.clear(input);
    await user.type(input, "log");
    await user.keyboard("{ArrowDown}{Tab}");
    expect(input).toHaveValue("logs/");

    await user.click(input);
    await user.clear(input);
    await user.type(input, "arc");
    expect(input).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("arc");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });
});

describe("SettingsMultiValueAutocomplete", () => {
  it("adds free-form values and removes existing values without changing their text", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [values, setValues] = useState(["s3:GetObject"]);
      return (
        <SettingsMultiValueAutocomplete
          label="Actions"
          itemLabel="action"
          inputLabel="Add action"
          values={values}
          onChange={setValues}
          suggestions={[{ value: "s3:PutObject" }]}
        />
      );
    }

    render(<Harness />);
    expect(screen.getByText("s3:GetObject")).toBeInTheDocument();

    const input = screen.getByRole("combobox", { name: "Add action" });
    await user.type(input, "custom:ExactValue{Enter}");
    expect(screen.getByText("custom:ExactValue")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove action s3:GetObject" }));
    expect(screen.queryByText("s3:GetObject")).not.toBeInTheDocument();
  });

  it("commits a free-form draft once when Add also triggers input blur", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [values, setValues] = useState<string[]>([]);
      return (
        <SettingsMultiValueAutocomplete
          label="Headers"
          itemLabel="header"
          inputLabel="Add header"
          values={values}
          onChange={setValues}
        />
      );
    }

    render(<Harness />);
    await user.type(screen.getByRole("combobox", { name: "Add header" }), "X-Custom-Header");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getAllByText("X-Custom-Header")).toHaveLength(1);
  });
});
