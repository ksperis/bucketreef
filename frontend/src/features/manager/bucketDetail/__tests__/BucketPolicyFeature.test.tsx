import { useEffect } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BucketPolicyFeature from "../BucketPolicyFeature";
import { useBucketPolicyController } from "../useBucketPolicyController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketPolicy: vi.fn(),
  getBucketPolicy: vi.fn(),
  putBucketPolicy: vi.fn(),
}));

vi.mock("../../../../api/bucketDetails", () => ({
  deleteBucketPolicy: (...args: unknown[]) => apiMocks.deleteBucketPolicy(...args),
  getBucketPolicy: (...args: unknown[]) => apiMocks.getBucketPolicy(...args),
  putBucketPolicy: (...args: unknown[]) => apiMocks.putBucketPolicy(...args),
}));

vi.mock("../../../../api/cephAdminBucketDetails", () => ({
  deleteCephAdminBucketPolicy: vi.fn(),
  getCephAdminBucketPolicy: vi.fn(),
  putCephAdminBucketPolicy: vi.fn(),
}));

const simplePolicy = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "ReadObjects",
      Effect: "Allow",
      Principal: "*",
      Action: "s3:GetObject",
      Resource: "arn:aws:s3:::reports/*",
    },
  ],
};

function PolicyHarness() {
  const controller = useBucketPolicyController({
    accountId: "acc-1",
    bucketName: "reports",
    cephAdmin: false,
    enabled: true,
    endpointId: null,
  });
  const { load } = controller;
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <BucketPolicyFeature
      bucketName="reports"
      controller={controller}
      onRequestDelete={() => undefined}
    />
  );
}

function renderPolicyFeature() {
  return render(
    <MemoryRouter>
      <PolicyHarness />
    </MemoryRouter>,
  );
}

describe("BucketPolicyFeature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps Properties read-only and guards Cancel for a dirty Visual draft", async () => {
    apiMocks.getBucketPolicy.mockResolvedValue({ policy: simplePolicy });
    const user = userEvent.setup();
    renderPolicyFeature();

    const section = await screen.findByTestId("bucket-feature-policy");
    await waitFor(() => expect(within(section).getByText("ReadObjects")).toBeInTheDocument());
    expect(within(section).getByText("1 statement · 1 Allow · 0 Deny")).toBeInTheDocument();
    expect(within(section).getByText("s3:GetObject")).toBeInTheDocument();
    expect(within(section).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("dialog", { name: "Edit bucket policy" });
    const sid = within(editor).getByLabelText("Sid");
    fireEvent.change(sid, { target: { value: "ChangedSid" } });
    expect(apiMocks.putBucketPolicy).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketPolicy).not.toHaveBeenCalled();

    await user.click(within(editor).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("dialog", { name: "Edit bucket policy" })).toBeVisible();

    await user.click(within(screen.getByRole("dialog", { name: "Edit bucket policy" })).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard changes", exact: true }));
    expect(screen.queryByRole("dialog", { name: "Edit bucket policy" })).not.toBeInTheDocument();
    expect(within(section).getByText("ReadObjects")).toBeInTheDocument();
    expect(apiMocks.putBucketPolicy).not.toHaveBeenCalled();
  });

  it("keeps an empty policy summary compact and configurable", async () => {
    apiMocks.getBucketPolicy.mockResolvedValue({ policy: null });
    const user = userEvent.setup();
    renderPolicyFeature();

    const section = await screen.findByTestId("bucket-feature-policy");
    await waitFor(() => expect(within(section).getByRole("button", { name: "Configure" })).toBeEnabled());
    expect(within(section).queryByText("No bucket policy configured.")).not.toBeInTheDocument();
    expect(within(section).queryByText("Not configured · 0 statements")).not.toBeInTheDocument();
    expect(within(section).queryByRole("table")).not.toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "Configure" }));
    expect(screen.getByRole("dialog", { name: "Edit bucket policy" })).toBeVisible();
    expect(screen.getByText("No statements. Add a statement or use JSON. Saving an empty policy removes it from the bucket.")).toBeInTheDocument();
  });

  it("shows advanced statements read-only in Visual and intact in JSON", async () => {
    const advancedPolicy = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "Advanced",
          Effect: "Deny",
          Principal: {
            AWS: "arn:aws:iam::111122223333:root",
            Service: "example.amazonaws.com",
          },
          NotAction: "s3:GetObject",
          Resource: "arn:aws:s3:::reports/*",
        },
      ],
    };
    apiMocks.getBucketPolicy.mockResolvedValue({ policy: advancedPolicy });
    const user = userEvent.setup();
    renderPolicyFeature();

    const section = await screen.findByTestId("bucket-feature-policy");
    await waitFor(() => expect(within(section).getAllByText("Advanced")).toHaveLength(2));
    await user.click(within(section).getByRole("button", { name: "Edit" }));

    const editor = screen.getByRole("dialog", { name: "Edit bucket policy" });
    expect(within(editor).getByText("Advanced statement — edit in JSON")).toBeInTheDocument();
    expect(within(editor).queryByRole("button", { name: "Remove statement" })).not.toBeInTheDocument();

    await user.click(within(editor).getByRole("tab", { name: "JSON" }));
    expect(within(editor).getByLabelText("Bucket policy (JSON)")).toHaveValue(
      JSON.stringify(advancedPolicy, null, 2),
    );
  });

  it("allows editing a representable Condition without persisting before Save", async () => {
    apiMocks.getBucketPolicy.mockResolvedValue({
      policy: {
        ...simplePolicy,
        Statement: [{
          ...simplePolicy.Statement[0],
          Condition: { StringEquals: { "aws:SourceAccount": "123456789012" } },
        }],
      },
    });
    apiMocks.putBucketPolicy.mockImplementation(
      (_accountId: unknown, _bucketName: unknown, policy: unknown) => Promise.resolve({ policy }),
    );
    const user = userEvent.setup();
    renderPolicyFeature();

    const section = await screen.findByTestId("bucket-feature-policy");
    await waitFor(() => expect(within(section).getByText("ReadObjects")).toBeInTheDocument());
    await user.click(within(section).getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("dialog", { name: "Edit bucket policy" });
    const values = within(editor).getByLabelText("Values — StringEquals / aws:SourceAccount");
    fireEvent.change(values, { target: { value: "123456789012\n210987654321" } });
    expect(apiMocks.putBucketPolicy).not.toHaveBeenCalled();

    await user.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMocks.putBucketPolicy).toHaveBeenCalledTimes(1));
    expect(apiMocks.putBucketPolicy.mock.calls[0][2]).toMatchObject({
      Statement: [{
        Condition: {
          StringEquals: {
            "aws:SourceAccount": ["123456789012", "210987654321"],
          },
        },
      }],
    });
  });
});
