export function requireHTMLElement(element: Element | null, message: string): HTMLElement {
  if (!(element instanceof HTMLElement)) {
    throw new Error(message);
  }
  return element;
}
