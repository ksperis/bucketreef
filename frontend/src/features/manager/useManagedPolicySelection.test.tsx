import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import type { IamPolicy } from "../../api/managerIamPolicies";
import { useManagedPolicySelection } from "./useManagedPolicySelection";

const policyA: IamPolicy = {
  name: "PolicyA",
  arn: "arn:aws:iam::123456789012:policy/PolicyA",
};
const policyB: IamPolicy = {
  name: "PolicyB",
  arn: "arn:aws:iam::123456789012:policy/PolicyB",
};

describe("useManagedPolicySelection", () => {
  it("loads policies and resets the complete selection state", async () => {
    const loadRelated = async <RelatedItem,>(
      _contextId: S3ExecutionContextSelector,
      _listItems: (contextId: S3ExecutionContextSelector) => Promise<RelatedItem[]>,
      setItems: (items: RelatedItem[]) => void,
    ) => {
      setItems([policyA, policyB] as unknown as RelatedItem[]);
    };
    const { result } = renderHook(() => useManagedPolicySelection(loadRelated));

    await act(async () => {
      await result.current.loadPolicies("acc-1");
    });
    expect(result.current.policies).toEqual([policyA, policyB]);

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

  it("drops selected policy arns that disappear from the inventory", async () => {
    const loadRelated = async <RelatedItem,>(
      _contextId: S3ExecutionContextSelector,
      _listItems: (contextId: S3ExecutionContextSelector) => Promise<RelatedItem[]>,
      _setItems: (items: RelatedItem[]) => void,
    ) => undefined;
    const { result } = renderHook(() => useManagedPolicySelection(loadRelated));

    act(() => {
      result.current.setPolicies([policyA, policyB]);
      result.current.setSelectedPolicies([policyA.arn, policyB.arn]);
    });
    await waitFor(() =>
      expect(result.current.selectedPolicies).toEqual([policyA.arn, policyB.arn]),
    );

    act(() => result.current.setPolicies([policyB]));
    await waitFor(() => expect(result.current.selectedPolicies).toEqual([policyB.arn]));
  });
});
