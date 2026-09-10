/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */

/** Wait for field errors to render before moving focus into a long form. */
export function focusFirstInvalidField(form: HTMLFormElement): void {
  window.requestAnimationFrame(() => {
    if (form.isConnected) {
      form.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')?.focus();
    }
  });
}
