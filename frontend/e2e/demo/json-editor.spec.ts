/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { openDemo } from "./helpers";

async function clickHighlightedText(page: Page, editor: Locator, marker: string) {
  await editor.scrollIntoViewIfNeeded();
  const point = await editor.locator("..").evaluate((root, marker) => {
    const input = root.querySelector("textarea");
    const highlight = root.querySelector("pre");
    if (!input || !highlight) throw new Error("JSON editor layers are missing");
    const offset = input.value.indexOf(marker);
    if (offset < 0) throw new Error(`Missing JSON marker: ${marker}`);
    const walker = document.createTreeWalker(highlight, NodeFilter.SHOW_TEXT);
    let seen = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const length = node.textContent?.length ?? 0;
      if (offset < seen + length) {
        const range = document.createRange();
        range.setStart(node, offset - seen);
        range.setEnd(node, offset - seen + 1);
        const bounds = range.getBoundingClientRect();
        const viewport = input.getBoundingClientRect();
        if (bounds.left < viewport.left || bounds.right > viewport.right ||
            bounds.top < viewport.top || bounds.bottom > viewport.bottom) {
          throw new Error(`JSON marker is outside the editor viewport: ${marker}`);
        }
        return { offset, x: bounds.left + 1, y: bounds.top + bounds.height / 2 };
      }
      seen += length;
    }
    throw new Error("Highlighted JSON position is missing");
  }, marker);

  // Click where the colored character is drawn, not a calculated textarea column.
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => editor.evaluate((input: HTMLTextAreaElement) => input.selectionStart)).toBe(point.offset);
  return point.offset;
}

for (const { width, theme, name } of [
  { width: 1440, theme: "light", name: "desktop light" },
  { width: 1440, theme: "dark", name: "desktop dark" },
  { width: 390, theme: "light", name: "mobile light" },
]) {
  test(`bucket JSON editor keeps clicks, indentation and scrolling aligned (${name})`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ colorScheme: "light" });
    await openDemo(page, "/manager/buckets/helios-logs?ctx=101");
    await page.getByRole("tab", { name: "Properties", exact: true }).click();
    if (theme === "dark") await page.getByRole("button", { name: "Switch to dark theme", exact: true }).click();
    await page.getByRole("button", { name: "Advanced editor", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit lifecycle rules", exact: true });
    await dialog.getByRole("tab", { name: "JSON", exact: true }).click();
    const editor = dialog.getByRole("textbox", { name: "Lifecycle rules (JSON)", exact: true });
    const rules = [{
      ID: "indented-rule",
      Filter: { Prefix: "folder/".repeat(40) },
      Status: "Enabled",
      NoncurrentVersionExpiration: { NoncurrentDays: 90 },
    }];
    const draft = JSON.stringify(rules, null, 2);
    await editor.fill(draft);

    const position = await clickHighlightedText(page, editor, "Enabled");
    await page.keyboard.insertText("X");
    await expect(editor).toHaveValue(`${draft.slice(0, position)}X${draft.slice(position)}`);

    await editor.fill(JSON.stringify(rules));
    await dialog.getByRole("button", { name: "Format JSON", exact: true }).click();
    await expect(editor).toHaveValue(draft);
    await expect.poll(() => editor.evaluate((input: HTMLTextAreaElement) => input.selectionStart)).toBe(draft.length);
    // Formatting a compact document can retain its horizontal scroll position.
    await editor.evaluate((input: HTMLTextAreaElement) => { input.scrollLeft = 0; });
    await expect.poll(() => editor.locator("..").evaluate(root => root.querySelector("pre")!.scrollLeft)).toBe(0);
    // Formatting and Tab must leave the visible indented line clickable.
    const prefixPosition = await clickHighlightedText(page, editor, '"Prefix"');
    await editor.press("Tab");
    await expect(editor).toHaveValue(`${draft.slice(0, prefixPosition)}  ${draft.slice(prefixPosition)}`);
    await expect.poll(() => editor.evaluate((input: HTMLTextAreaElement) => input.selectionStart)).toBe(prefixPosition + 2);
    await clickHighlightedText(page, editor, '"Prefix"');
    await editor.press("Shift+Tab");
    await expect(editor).toHaveValue(draft);
    await expect.poll(() => editor.evaluate((input: HTMLTextAreaElement) => input.selectionStart)).toBe(prefixPosition);

    const manyRules = JSON.stringify(Array.from({ length: 12 }, (_, index) => ({
      ID: `rule-${index}`,
      Status: "Enabled",
      Filter: { Prefix: `folder-${index}/` },
    })), null, 2);
    await editor.fill(manyRules);
    await editor.evaluate((input: HTMLTextAreaElement) => { input.scrollTop = input.scrollHeight; });
    // The highlight must not stop scrolling before the textarea at the bottom.
    await expect.poll(() => editor.locator("..").evaluate(root => {
      const input = root.querySelector("textarea")!;
      const highlight = root.querySelector("pre")!;
      return {
        scrolled: input.scrollTop > 0,
        heightDelta: input.getBoundingClientRect().height - highlight.getBoundingClientRect().height,
        scrollDelta: input.scrollTop - highlight.scrollTop,
      };
    })).toEqual({ scrolled: true, heightDelta: 0, scrollDelta: 0 });
    const lastPosition = await clickHighlightedText(page, editor, "folder-11/");
    await page.keyboard.insertText("X");
    await expect(editor).toHaveValue(`${manyRules.slice(0, lastPosition)}X${manyRules.slice(lastPosition)}`);
    expect(pageErrors).toEqual([]);
    expect(await page.evaluate(() => window.__bucketreefDemo.failures)).toEqual([]);
  });
}
