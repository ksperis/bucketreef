import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ObjectTextPreview from "./ObjectTextPreview";
import { parsePreviewCsv, parsePreviewJson, truncatePreviewText } from "./objectTextParsers";

describe("bounded structured previews", () => {
  it("parses quoted delimiters, escaped quotes, Unicode, CRLF and multiline cells", () => {
    expect(parsePreviewCsv('name,value\r\n"é, test","two\nlines"\r\n"a""b",3\r\n')).toEqual([
      ["name", "value"], ["é, test", "two\nlines"], ['a"b', "3"],
    ]);
    expect(parsePreviewCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(() => parsePreviewCsv('a,b\n"unterminated')).toThrow();
    expect(() => parsePreviewCsv('a,b\n1,2,3')).toThrow();
    expect(() => parsePreviewCsv('a,b\n"a"x,2')).toThrow();
  });
  it("bounds UTF-8 bytes without splitting a character or rendering an unbounded JSON tree", () => {
    expect(truncatePreviewText("é🙂é", 5)).toEqual({ content: "é", truncated: true });
    expect(() => parsePreviewJson("[".repeat(40) + "0" + "]".repeat(40))).toThrow();
    expect(() => parsePreviewJson(JSON.stringify(Array(6000).fill(0)))).toThrow();
  });
  it("shows CSV as inert cells and finds literal text in the displayed source", () => {
    const { container } = render(<ObjectTextPreview name="report.csv" content={'name,value\n<script>,"[x] [x]"'} truncated={false} heightClassName="max-h-80" />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "<script>" })).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "[x]" } });
    expect(screen.getByRole("status")).toHaveTextContent("2 matches");
    expect(container.querySelectorAll("mark")).toHaveLength(2);
  });
  it("renders collapsible JSON and supports switching back to raw source", () => {
    const content = '{"settings":{"enabled":true}}';
    const { container } = render(<ObjectTextPreview name="settings.json" content={content} truncated={false} heightClassName="max-h-80" />);
    expect(container.querySelectorAll("details")).toHaveLength(2);
    expect(container.querySelectorAll("details")[1]).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Raw text" }));
    expect(screen.getByText(content)).toBeInTheDocument();
  });
  it.each([["bad.json", "{oops}", false], ["bad.csv", 'a,b\n"oops', false], ["cut.json", "{}", true]])("falls back to raw text for %s", (name, content, truncated) => {
    render(<ObjectTextPreview name={name as string} content={content as string} truncated={truncated as boolean} heightClassName="max-h-80" />);
    expect(screen.getByText(/Raw text: invalid/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
