import type { BrowserItem } from "./browserTypes";
import type { BrowserTextFn } from "./browserI18n";

export function isBrowserInteractiveTarget(
  target: EventTarget | null,
): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element?.closest("button, a, input, textarea, select, label"),
  );
}

export function resolveBrowserItemOpenLabel(item: BrowserItem, text: BrowserTextFn): string {
  if (item.isDeleted) return text("Open versions for {name}", { name: item.name });
  return item.type === "folder"
    ? text("Open folder {name}", { name: item.name })
    : text("Open file {name}", { name: item.name });
}
