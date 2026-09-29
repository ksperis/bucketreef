import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import TopbarWorkspaceSelector from "../TopbarWorkspaceSelector";

describe("TopbarWorkspaceSelector", () => {
  it("renders a single fixed workspace as static context", () => {
    const { container } = render(<TopbarWorkspaceSelector section="Ceph Admin" />);

    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Ceph Admin")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch workspace" })).not.toBeInTheDocument();
    expect(container.querySelector(".shell-control-static")).toBeInTheDocument();
    expect(container.querySelector(".shell-control")).not.toBeInTheDocument();
  });
});
