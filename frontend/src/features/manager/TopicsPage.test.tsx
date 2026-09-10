import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TopicsPage from "./TopicsPage";

const useS3AccountContextMock = vi.fn();
const listTopicsMock = vi.fn();
const getTopicConfigurationMock = vi.fn();
const updateTopicConfigurationMock = vi.fn();
const deleteTopicMock = vi.fn();
const createTopicMock = vi.fn();
const getTopicPolicyMock = vi.fn();
const updateTopicPolicyMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../api/topics", async () => {
  const actual = await vi.importActual<typeof import("../../api/topics")>("../../api/topics");
  return {
    ...actual,
    listTopics: (...args: unknown[]) => listTopicsMock(...args),
    createTopic: (...args: unknown[]) => createTopicMock(...args),
    deleteTopic: (...args: unknown[]) => deleteTopicMock(...args),
    getTopicConfiguration: (...args: unknown[]) => getTopicConfigurationMock(...args),
    getTopicPolicy: (...args: unknown[]) => getTopicPolicyMock(...args),
    updateTopicConfiguration: (...args: unknown[]) => updateTopicConfigurationMock(...args),
    updateTopicPolicy: (...args: unknown[]) => updateTopicPolicyMock(...args),
  };
});

describe("TopicsPage", () => {
  beforeEach(() => {
    useS3AccountContextMock.mockReset();
    listTopicsMock.mockReset();
    getTopicConfigurationMock.mockReset();
    updateTopicConfigurationMock.mockReset();
    deleteTopicMock.mockReset();
    createTopicMock.mockReset();
    getTopicPolicyMock.mockReset();
    updateTopicPolicyMock.mockReset();
    useS3AccountContextMock.mockReturnValue({
      accounts: [],
      selectedS3AccountId: null,
      accountIdForApi: null,
      requiresS3AccountSelection: true,
      sessionS3AccountName: null,
      accessMode: "default",
      iamIdentity: null,
    });
    listTopicsMock.mockResolvedValue([]);
    getTopicConfigurationMock.mockResolvedValue({ configuration: {} });
    updateTopicConfigurationMock.mockImplementation(
      async (_accountId: unknown, _topicArn: unknown, configuration: Record<string, unknown>) => ({ configuration })
    );
  });

  it("shows an empty state without a page-level context strip when no account is selected", () => {
    render(
      <MemoryRouter>
        <TopicsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Select an account before managing SNS topics")).toBeInTheDocument();
    expect(screen.queryByText("Execution context")).not.toBeInTheDocument();
    expect(screen.queryByText("Select an account to manage its topics.")).not.toBeInTheDocument();
  });

  it("confirms before deleting a notification topic", async () => {
    const user = userEvent.setup();
    const topicArn = "arn:aws:sns:us-east-1:lab:topic-events";
    useS3AccountContextMock.mockReturnValue({
      accounts: [{ id: 7, display_name: "Lab account", storage_endpoint_capabilities: { sns: true } }],
      selectedS3AccountId: 7,
      accountIdForApi: 7,
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      accessMode: "default",
      iamIdentity: null,
    });
    listTopicsMock.mockResolvedValue([{ name: "topic-events", arn: topicArn, configuration: {} }]);

    render(
      <MemoryRouter>
        <TopicsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("topic-events")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteTopicMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete notification topic?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete topic" }));
    await waitFor(() => expect(deleteTopicMock).toHaveBeenCalledWith(7, topicArn));
  });

  it("loads normalized Ceph topic configuration into the attributes modal and saves the edited payload", async () => {
    const user = userEvent.setup();
    const topicArn = "arn:aws:sns:us-east-1:lab:topic-events";
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: 7,
          display_name: "Lab account",
          storage_endpoint_capabilities: { sns: true },
        },
      ],
      selectedS3AccountId: 7,
      accountIdForApi: 7,
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      accessMode: "default",
      iamIdentity: null,
    });
    listTopicsMock.mockResolvedValue([
      {
        name: "topic-events",
        arn: topicArn,
        configuration: { "verify-ssl": "false" },
      },
    ]);
    getTopicConfigurationMock.mockResolvedValue({
      configuration: {
        "push-endpoint": "https://notify.example.test/hooks/current",
        "verify-ssl": "false",
        OpaqueData: "trace=lab",
        persistent: true,
      },
    });

    render(
      <MemoryRouter>
        <TopicsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("topic-events")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Attributes" }));

    const dialog = (await screen.findByRole("heading", { name: "Topic attributes · topic-events" })).closest(
      ".workflow-page"
    );
    if (!dialog) throw new Error("Topic attributes workflow page not found");
    const endpointInput = within(dialog).getByRole("textbox", { name: "Push endpoint URL" });
    await waitFor(() => expect(endpointInput).toHaveValue("https://notify.example.test/hooks/current"));
    expect(within(dialog).getByRole("checkbox", { name: "Verify SSL certificates" })).not.toBeChecked();

    const attributeKeys = within(dialog).getAllByRole("textbox", { name: /Attribute name \d+/ });
    const attributeValues = within(dialog).getAllByRole("textbox", { name: /Attribute value \d+/ });
    expect(attributeKeys.map((input) => (input as HTMLInputElement).value)).toEqual(["OpaqueData", "persistent"]);
    expect(attributeValues.map((input) => (input as HTMLInputElement).value)).toEqual(["trace=lab", "true"]);

    const firstAttributeKey = attributeKeys[0];
    await user.type(firstAttributeKey, "-updated");
    expect(firstAttributeKey).toHaveFocus();
    expect(within(dialog).getAllByPlaceholderText("attribute-key")[0]).toBe(firstAttributeKey);
    expect(firstAttributeKey).toHaveValue("OpaqueData-updated");

    await user.clear(endpointInput);
    await user.type(endpointInput, "https://notify.example.test/hooks/updated");
    await user.click(within(dialog).getByRole("button", { name: "Save attributes" }));

    await waitFor(() => expect(updateTopicConfigurationMock).toHaveBeenCalledTimes(1));
    expect(updateTopicConfigurationMock).toHaveBeenCalledWith(7, topicArn, {
      "push-endpoint": "https://notify.example.test/hooks/updated",
      "verify-ssl": false,
      "OpaqueData-updated": "trace=lab",
      persistent: "true",
    });
  });

  it("retains the create draft while pending and restores dismissal after a failure", async () => {
    const user = userEvent.setup();
    useS3AccountContextMock.mockReturnValue({ accountIdForApi: "conn-7", accounts: [], requiresS3AccountSelection: false });
    let rejectCreate!: (error: Error) => void;
    createTopicMock.mockReturnValue(new Promise((_resolve, reject) => { rejectCreate = reject; }));
    render(<MemoryRouter><TopicsPage /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Create topic" }));
    const dialog = screen.getByRole("dialog", { name: "Create SNS topic" });
    const name = within(dialog).getByRole("textbox", { name: "Topic name" });
    await user.click(within(dialog).getByRole("button", { name: "Create topic" }));
    expect(name).toHaveAccessibleDescription("Topic name is required.");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(createTopicMock).not.toHaveBeenCalled();
    await user.type(name, "  topic-events  ");
    expect(name).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Topic name is required.")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Create topic" }));
    expect(createTopicMock).toHaveBeenCalledWith("conn-7", { name: "topic-events" });
    expect(name).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Close modal" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();
    rejectCreate(new Error("Creation failed"));
    expect(await within(dialog).findByText("Creation failed")).toBeInTheDocument();
    expect(name).toBeEnabled();
    expect(name).toHaveValue("  topic-events  ");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(within(screen.getByRole("dialog", { name: "Discard changes?" })).getByRole("button", { name: "Keep editing" }));
    expect(name).toHaveValue("  topic-events  ");
  });

  it("associates JSON validation and saves exactly the displayed policy example in the current context", async () => {
    const user = userEvent.setup();
    const topicArn = "arn:aws:sns:default:tenant:topic-events";
    useS3AccountContextMock.mockReturnValue({ accountIdForApi: "s3u-7", accounts: [], requiresS3AccountSelection: false });
    listTopicsMock.mockResolvedValue([{ name: "topic-events", arn: topicArn }]);
    getTopicPolicyMock.mockResolvedValue({ policy: { Version: "2012-10-17", Statement: [] } });
    let rejectSave!: (error: Error) => void;
    updateTopicPolicyMock.mockReturnValue(new Promise((_resolve, reject) => { rejectSave = reject; }));
    render(<MemoryRouter><TopicsPage /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "Policy" }));
    const editor = screen.getByRole("textbox", { name: "Policy JSON" });
    await waitFor(() => expect(editor).toBeEnabled());
    await user.clear(editor);
    await user.type(editor, "invalid");
    await user.click(screen.getByRole("button", { name: "Save policy" }));
    expect(editor).toHaveAttribute("aria-invalid", "true");
    expect(editor).toHaveAccessibleDescription("Policy must be valid JSON.");
    expect(updateTopicPolicyMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Use example" }));
    expect(editor).not.toHaveAttribute("aria-invalid", "true");
    const toggle = screen.getByRole("button", { name: "Hide example" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const example = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(example).toHaveTextContent((editor as HTMLTextAreaElement).value.replace(/\s+/g, " "));
    const policy = JSON.parse((editor as HTMLTextAreaElement).value);
    expect(policy.Statement[0].Resource).toBe(topicArn);
    await user.click(screen.getByRole("button", { name: "Save policy" }));
    expect(updateTopicPolicyMock).toHaveBeenCalledWith("s3u-7", topicArn, policy);
    expect(editor).toBeDisabled();
    expect(screen.getByRole("button", { name: "Use example" })).toBeDisabled();
    rejectSave(new Error("Policy save failed"));
    expect(await screen.findByText("Policy save failed")).toBeInTheDocument();
    expect(editor).toBeEnabled();
    expect(editor).not.toHaveAttribute("aria-invalid", "true");
    expect(JSON.parse((editor as HTMLTextAreaElement).value)).toEqual(policy);
  });

  it("renders canonical Ceph topics without raw notification details", async () => {
    const user = userEvent.setup();
    const topicArn = "arn:aws:sns:default:tenant:ceph-topic-main";
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: 7,
          display_name: "Lab account",
          storage_endpoint_capabilities: { sns: true },
        },
      ],
      selectedS3AccountId: 7,
      accountIdForApi: 7,
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      accessMode: "default",
      iamIdentity: null,
    });
    listTopicsMock.mockResolvedValue([
      {
        name: "ceph-topic-main",
        arn: topicArn,
      },
      {
        name: "secondary-topic",
        arn: "arn:aws:sns:default:tenant:secondary-topic",
      },
    ]);

    render(
      <MemoryRouter>
        <TopicsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("ceph-topic-main")).toBeInTheDocument();
    expect(screen.getAllByText("ceph-topic-main")).toHaveLength(1);
    expect(screen.getByText("secondary-topic")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByText("ceph-topic-main").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.queryByRole("columnheader", { name: "Subscriptions" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Attributes" })[0].closest("td")).toHaveAttribute(
      "data-mobile-actions",
      "true"
    );
    expect(screen.queryByText("Notifications: 3")).not.toBeInTheDocument();
    expect(screen.queryByText("Notification: projet-test-s3ls-unistra-preprod")).not.toBeInTheDocument();
    expect(screen.queryByText("Notification: archive-daily-created")).not.toBeInTheDocument();
    expect(screen.queryByText("Notification: notif.legacy-name")).not.toBeInTheDocument();
    expect(screen.queryByText("Bucket: bucket-alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("Bucket: projet-test-s3ls-unistra-preprod")).not.toBeInTheDocument();
    expect(screen.queryByText("Endpoint: https://notify.example.test/hooks/a")).not.toBeInTheDocument();
    expect(screen.queryByText("Endpoint topic: endpoint-topic-a")).not.toBeInTheDocument();
    expect(screen.queryByText("Persistent: true")).not.toBeInTheDocument();
    expect(screen.queryByText("verify-ssl: false · time_to_live: 60 · OpaqueData: trace-a")).not.toBeInTheDocument();
    expect(screen.queryByText("Endpoint: https://notify.example.test/hooks/b")).not.toBeInTheDocument();
    expect(screen.queryByText("Endpoint: https://notify.example.test/hooks/hidden")).not.toBeInTheDocument();
    expect(screen.queryByText("Version: 2012-10-17")).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search by topic or ARN"), "projet-test-s3ls");

    expect(screen.queryByText("ceph-topic-main")).not.toBeInTheDocument();
    expect(screen.queryByText("secondary-topic")).not.toBeInTheDocument();
    expect(screen.getByText("No topics.")).toBeInTheDocument();
  });
});
