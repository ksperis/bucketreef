import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsConditionalBadge } from "./settings/SettingsLayout";

describe("SettingsConditionalBadge", () => {
  it("renders the badge when visible=true", () => {
    render(<SettingsConditionalBadge visible label="Experimental" />);
    expect(screen.getByText("Experimental")).toBeInTheDocument();
  });

  it("does not render the badge when visible=false", () => {
    render(<SettingsConditionalBadge visible={false} label="Experimental" />);
    expect(screen.queryByText("Experimental")).not.toBeInTheDocument();
  });
});
