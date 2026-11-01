import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IamPolicy } from "../../api/managerIamPolicies";
import { useManagedPolicySelection } from "./useManagedPolicySelection";

const listIamPoliciesPageMock = vi.fn();

vi.mock("../../api/managerIamPolicies", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamPolicies")>("../../api/managerIamPolicies");
  return {
    ...actual,
    listIamPoliciesPage: (...args: unknown[]) => listIamPoliciesPageMock(...args),
  };
});

const policyA: IamPolicy = {
  name: "PolicyA",
  arn: "arn:aws:iam::123456789012:policy/PolicyA",
};
const policyB: IamPolicy = {
  name: "PolicyB",
  arn: "arn:aws:iam::123456789012:policy/PolicyB",
};

describe("useManagedPolicySelection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listIamPoliciesPageMock.mockResolvedValue({
      items: [policyA, policyB],
      next_marker: null,
    });
  });

  it("loads policies and resets the complete selection state", async () => {
    const { result } = renderHook(() => useManagedPolicySelection());

    act(() => result.current.loadPolicies("acc-1"));
    await waitFor(() => expect(result.current.policies).toEqual([policyA, policyB]));

    act(() => {
      result.current.setSelectedPolicies([policyA.arn]);
      result.current.setPolicySearch("PolicyA");
    });
    await waitFor(() => expect(result.current.showPolicyOptions).toBe(true));

    act(() => result.current.resetPolicySelection());
    expect(result.current.selectedPolicies).toEqual([]);
    expect(result.current.policySearch).toBe("");
    expect(result.current.showPolicyOptions).toBe(false);
  });

  it("retains selected policy arns when moving between inventory pages", async () => {
    const { result } = renderHook(() => useManagedPolicySelection());

    act(() => {
      result.current.setPolicies([policyA, policyB]);
      result.current.setSelectedPolicies([policyA.arn, policyB.arn]);
    });
    await waitFor(() =>
      expect(result.current.selectedPolicies).toEqual([policyA.arn, policyB.arn]),
    );

    act(() => result.current.setPolicies([policyB]));
    await waitFor(() => expect(result.current.selectedPolicies).toEqual([policyA.arn, policyB.arn]));
  });
});
