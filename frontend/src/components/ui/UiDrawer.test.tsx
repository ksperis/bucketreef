import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import UiDrawer, { UiDrawerBody, UiDrawerFooter, UiDrawerHeader } from "./UiDrawer";

function DrawerHarness({ modal = true, backdrop = false }: { modal?: boolean; backdrop?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open drawer</button>
      {open ? (
        <UiDrawer
          ariaLabelledBy="drawer-title"
          modal={modal}
          showBackdrop={backdrop}
          onClose={() => setOpen(false)}
        >
          <UiDrawerHeader><h2 id="drawer-title">Drawer title</h2></UiDrawerHeader>
          <UiDrawerBody><button type="button">First action</button></UiDrawerBody>
          <UiDrawerFooter>Footer</UiDrawerFooter>
        </UiDrawer>
      ) : null}
    </>
  );
}

describe("UiDrawer", () => {
  it("owns modal focus, body scroll, Escape, and focus restoration", () => {
    render(<DrawerHarness />);
    const opener = screen.getByRole("button", { name: "Open drawer" });
    opener.focus();
    fireEvent.click(opener);

    const drawer = screen.getByRole("dialog", { name: "Drawer title" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "First action" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Drawer title" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(opener).toHaveFocus();
  });

  it("keeps complementary drawers non-modal while retaining Escape", () => {
    render(<DrawerHarness modal={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Open drawer" }));

    const drawer = screen.getByRole("complementary", { name: "Drawer title" });
    expect(drawer).not.toHaveAttribute("aria-modal");
    expect(document.body.style.overflow).toBe("");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Drawer title" })).not.toBeInTheDocument();
  });

  it("closes only when the optional backdrop itself is pressed", () => {
    const onClose = vi.fn();
    render(
      <UiDrawer ariaLabelledBy="drawer-title" showBackdrop onClose={onClose}>
        <UiDrawerHeader><h2 id="drawer-title">Drawer title</h2></UiDrawerHeader>
        <UiDrawerBody><button type="button">Inside</button></UiDrawerBody>
      </UiDrawer>
    );

    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Drawer title" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close drawer" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
