import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ManagerIamPoliciesCell from "./ManagerIamPoliciesCell";

describe("ManagerIamPoliciesCell", () => {
  it("renders a dash only when both policy categories are empty", () => {
    render(<ManagerIamPoliciesCell managedPolicies={[]} inlinePolicies={[]} />);

    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.queryByText("Managed")).not.toBeInTheDocument();
    expect(screen.queryByText("Inline")).not.toBeInTheDocument();
  });

  it("renders only the managed row when there are no inline policies", () => {
    render(
      <ManagerIamPoliciesCell
        managedPolicies={["arn:aws:iam::aws:policy/ReadOnlyAccess"]}
      />,
    );

    expect(screen.getByText("Managed")).toBeInTheDocument();
    expect(screen.getByText("ReadOnlyAccess")).toHaveAttribute(
      "title",
      "arn:aws:iam::aws:policy/ReadOnlyAccess",
    );
    expect(screen.queryByText("Inline")).not.toBeInTheDocument();
  });

  it("renders only the inline row when there are no managed policies", () => {
    render(<ManagerIamPoliciesCell inlinePolicies={["bucket-read"]} />);

    expect(screen.getByText("Inline")).toBeInTheDocument();
    expect(screen.getByText("bucket-read")).toHaveAttribute("title", "bucket-read");
    expect(screen.queryByText("Managed")).not.toBeInTheDocument();
  });

  it("limits each category to two named badges and exposes hidden names on +N", () => {
    render(
      <ManagerIamPoliciesCell
        managedPolicies={[
          "arn:aws:iam::aws:policy/ManagedOne",
          "arn:aws:iam::aws:policy/ManagedTwo",
          "arn:aws:iam::aws:policy/ManagedThree",
          "arn:aws:iam::aws:policy/ManagedFour",
        ]}
        inlinePolicies={["inline-one", "inline-two", "inline-three"]}
      />,
    );

    expect(screen.getByText("ManagedOne")).toBeInTheDocument();
    expect(screen.getByText("ManagedTwo")).toBeInTheDocument();
    expect(screen.queryByText("ManagedThree")).not.toBeInTheDocument();
    expect(screen.getByText("+2")).toHaveAttribute("title", "ManagedThree, ManagedFour");

    expect(screen.getByText("inline-one")).toBeInTheDocument();
    expect(screen.getByText("inline-two")).toBeInTheDocument();
    expect(screen.queryByText("inline-three")).not.toBeInTheDocument();
    expect(screen.getByText("+1")).toHaveAttribute("title", "inline-three");
  });
});
