import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TopicsPage from "./TopicsPage";
import { transferableAbortController } from "node:util";

const useS3AccountContextMock = vi.fn();
const listTopicsMock = vi.fn();
const deleteTopicMock = vi.fn();
const createTopicMock = vi.fn();

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
  };
});

describe("TopicsPage", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  beforeEach(() => {
    vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
    useS3AccountContextMock.mockReset();
    listTopicsMock.mockReset();
    deleteTopicMock.mockReset();
    createTopicMock.mockReset();
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
    expect(within(dialog).getByRole("button", { name: "Close", exact: true })).toBeDisabled();
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
    const editLinks = screen.getAllByRole("link", { name: "Edit" });
    expect(editLinks[0]).toHaveAttribute("href", "/manager/topics/ceph-topic-main");
    expect(editLinks[0]).toHaveAttribute("data-table-default-action", "true");
    expect(editLinks[0].closest("td")).toHaveAttribute("data-mobile-actions", "true");
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

  it("retains a failed deletion for retry and blocks duplicate submissions and pending dismissal", async () => {
    const topicArn = "arn:aws:sns:default:tenant:topic-events";
    useS3AccountContextMock.mockReturnValue({ accountIdForApi: "conn-7", accounts: [], requiresS3AccountSelection: false });
    listTopicsMock.mockResolvedValue([{ name: "topic-events", arn: topicArn, configuration: {} }]);
    const user = userEvent.setup();
    let rejectDelete!: (error: Error) => void;
    deleteTopicMock.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectDelete = reject; })).mockResolvedValue(undefined);
    render(<MemoryRouter><TopicsPage /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "Delete", exact: true }));
    const dialog = screen.getByRole("dialog", { name: "Delete notification topic?" });
    const confirm = within(dialog).getByRole("button", { name: "Delete topic" });
    await user.dblClick(confirm);
    expect(deleteTopicMock).toHaveBeenCalledOnce();
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();
    await act(async () => rejectDelete(new Error("Delete unavailable")));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Delete unavailable");
    await user.click(confirm);
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(deleteTopicMock.mock.calls).toEqual([["conn-7", topicArn], ["conn-7", topicArn]]);
  });



it("marks invalid standard topic names immediately and blocks their creation", async () => {
  useS3AccountContextMock.mockReturnValue({ accounts: [], selectedS3AccountId: "7", accountIdForApi: "7", requiresS3AccountSelection: true });
  listTopicsMock.mockResolvedValue([]);
  createTopicMock.mockResolvedValue({ name: "valid_topic-1", arn: "arn:aws:sns:us-east-1:lab:valid_topic-1" });
  render(<MemoryRouter><TopicsPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Create topic", exact: true }));
  const dialog = screen.getByRole("dialog", { name: "Create SNS topic" });
  const name = within(dialog).getByLabelText("Topic name");
  expect(name).not.toHaveAttribute("aria-invalid", "true");
  fireEvent.change(name, { target: { value: "bad.topic" } });
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveAccessibleDescription(/1–256 ASCII/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Create topic", exact: true }));
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Create topic", exact: true })).toBeEnabled());
  expect(createTopicMock).not.toHaveBeenCalled();
  fireEvent.change(name, { target: { value: "valid_topic-1" } });
  expect(name).not.toHaveAttribute("aria-invalid", "true");
  fireEvent.click(within(dialog).getByRole("button", { name: "Create topic", exact: true }));
  await waitFor(() => expect(createTopicMock).toHaveBeenCalledWith("7", { name: "valid_topic-1" }));
});
});
