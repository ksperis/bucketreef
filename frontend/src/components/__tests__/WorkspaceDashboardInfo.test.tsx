import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import WorkspaceDashboardInfo from "../WorkspaceDashboardInfo";
import { WorkspaceDashboardCard } from "../WorkspaceDashboardKit";

function setup() {
  return render(<WorkspaceDashboardCard title="Metrics" presentation="compact"
    titleAccessory={<WorkspaceDashboardInfo label="About metrics"><p>Coverage and collection dates</p></WorkspaceDashboardInfo>}
  ><p>123</p></WorkspaceDashboardCard>);
}

afterEach(() => vi.useRealTimers());

describe("WorkspaceDashboardInfo", () => {
  it("keeps details hidden until focus and preserves the heading's accessible name", async () => {
    setup();
    expect(screen.getByRole("heading", { name: "Metrics" })).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "About metrics" });
    fireEvent.focus(trigger);
    const tooltip = screen.getByRole("tooltip");
    expect(trigger).toHaveAttribute("aria-describedby", tooltip.id);
    expect(tooltip).toHaveTextContent("Coverage and collection dates");
    // A portal tooltip is not a page landmark; check its content separately.
    await act(async () => {
      expect(await axe(tooltip, { rules: { region: { enabled: false } } })).toHaveNoViolations();
    });
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(trigger).not.toHaveAttribute("aria-describedby");
  });

  it("allows pointer movement from the trigger into the tooltip", () => {
    vi.useFakeTimers();
    setup();
    const anchor = screen.getByRole("button", { name: "About metrics" }).parentElement!;
    fireEvent.mouseEnter(anchor);
    const tooltip = screen.getByRole("tooltip");
    fireEvent.mouseLeave(anchor);
    fireEvent.mouseEnter(tooltip);
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseLeave(tooltip);
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("pins details on click or touch and closes on a second click or outside action", () => {
    vi.useFakeTimers();
    setup();
    const trigger = screen.getByRole("button", { name: "About metrics" });
    fireEvent.click(trigger);
    fireEvent.mouseLeave(trigger.parentElement!);
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText("123"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("cleans pending closure when the card unmounts", () => {
    vi.useFakeTimers();
    const { unmount } = setup();
    const anchor = screen.getByRole("button", { name: "About metrics" }).parentElement!;
    fireEvent.mouseEnter(anchor);
    fireEvent.mouseLeave(anchor);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
