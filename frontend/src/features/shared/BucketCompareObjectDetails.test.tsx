import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BucketCompareObjectDetails from "./BucketCompareObjectDetails";

const key = " /daily// object /report.json ";
const etag = "0123456789abcdef0123456789abcdef-12";

function renderDetails(onExplore = vi.fn()) {
  render(<>
    <BucketCompareObjectDetails rows={[{ key, etag: `"${etag}"`, size: 1024 }]}
      options={{ buildBrowserHref: () => "/browser?fixture", onExplore }} />
    <button type="button">Next control</button>
  </>);
  return screen.getByRole("button", { name: /Show object metadata/ });
}

describe("BucketCompareObjectDetails", () => {
  it("preserves complete object metadata and closes with focus restoration", async () => {
    const user = userEvent.setup();
    const trigger = renderDetails();
    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-controls", dialog.id);
    expect(within(dialog).getByText(etag)).toBeInTheDocument();
    expect(within(dialog).getByText((_, node) => node?.tagName === "P" && node.textContent === key)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Close object metadata" }));
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("lets Tab leave the popup from the object's position and preserves outside focus", async () => {
    const user = userEvent.setup();
    const trigger = renderDetails();
    await user.click(trigger);
    await user.tab({ shift: true });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(trigger);
    await user.tab();
    expect(screen.getByRole("button", { name: "Close object metadata" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Explore" })).toHaveFocus();
    // user-event uses the old event target for Tab; browser QA covers native continuation.
    fireEvent.keyDown(screen.getByRole("button", { name: "Explore" }), { key: "Tab" });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Next control" }));
    expect(screen.getByRole("button", { name: "Next control" })).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("restores the object trigger before dispatching a workspace action with the exact key", async () => {
    const user = userEvent.setup();
    const onExplore = vi.fn(() => expect(trigger).toHaveFocus());
    const trigger = renderDetails(onExplore);
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Explore" }));
    expect(onExplore).toHaveBeenCalledWith("/browser?fixture", expect.objectContaining({ key }), 0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
