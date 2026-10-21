import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { transferableAbortController } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ManagerTopicWorkspacePage from "./ManagerTopicWorkspacePage";

const api = vi.hoisted(() => ({
  listTopics: vi.fn(),
  getConfiguration: vi.fn(),
  updateConfiguration: vi.fn(),
  getPolicy: vi.fn(),
  updatePolicy: vi.fn(),
}));
const useS3AccountContextMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../api/topics", async (original) => ({
  ...await original<typeof import("../../api/topics")>(),
  listTopics: api.listTopics,
  getTopicConfiguration: api.getConfiguration,
  updateTopicConfiguration: api.updateConfiguration,
  getTopicPolicy: api.getPolicy,
  updateTopicPolicy: api.updatePolicy,
}));

function renderWorkspace(path: string) {
  const router = createMemoryRouter([
    { path: "/manager/topics/:topicName", element: <ManagerTopicWorkspacePage /> },
    { path: "/manager/topics/:topicName/policy", element: <ManagerTopicWorkspacePage /> },
  ], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe("ManagerTopicWorkspacePage", () => {
  const topicArn = "arn:aws:sns:default:tenant:topic-events";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
    useS3AccountContextMock.mockReturnValue({
      accounts: [{ id: "conn-7", display_name: "Lab", storage_endpoint_capabilities: { sns: true } }],
      selectedS3AccountId: "conn-7",
      contextIdForApi: "conn-7",
      requiresS3AccountSelection: false,
      accessMode: "default",
    });
    api.listTopics.mockResolvedValue([{ name: "topic-events", arn: topicArn, configuration: {} }]);
    api.getConfiguration.mockResolvedValue({ configuration: { "push-endpoint": "https://notify.example.test/current" } });
    api.updateConfiguration.mockImplementation(async (_account, _arn, configuration) => ({ configuration }));
    api.getPolicy.mockResolvedValue({ policy: { Version: "2012-10-17", Statement: [] } });
    api.updatePolicy.mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("resolves the topic ARN and edits its configuration from the default workspace tab", async () => {
    const router = renderWorkspace("/manager/topics/topic-events");

    expect(await screen.findByRole("heading", { name: "SNS topic: topic-events" })).toBeInTheDocument();
    await waitFor(() => expect(api.listTopics).toHaveBeenCalledWith("conn-7"));
    await waitFor(() => expect(api.getConfiguration).toHaveBeenCalledWith("conn-7", topicArn));

    const form = screen.getByRole("form", { name: "Topic attributes · topic-events" });
    const endpoint = within(form).getByRole("textbox", { name: "Push endpoint URL" });
    await waitFor(() => expect(endpoint).toHaveValue("https://notify.example.test/current"));
    fireEvent.change(endpoint, { target: { value: "https://notify.example.test/updated" } });
    fireEvent.submit(form);

    await waitFor(() => expect(api.updateConfiguration).toHaveBeenCalledWith("conn-7", topicArn, {
      "push-endpoint": "https://notify.example.test/updated",
    }));

    fireEvent.click(screen.getByRole("tab", { name: "Policy" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/manager/topics/topic-events/policy"));
    expect(await screen.findByRole("textbox", { name: "Policy JSON" })).toBeEnabled();
  });

  it("opens the Policy deep link and saves against the resolved ARN", async () => {
    renderWorkspace("/manager/topics/topic-events/policy");
    const editor = await screen.findByRole("textbox", { name: "Policy JSON" });
    await waitFor(() => expect(editor).toBeEnabled());
    const policy = { Version: "2012-10-17", Statement: [{ Effect: "Allow" }] };
    fireEvent.change(editor, { target: { value: JSON.stringify(policy) } });
    fireEvent.submit(editor.closest("form")!);

    await waitFor(() => expect(api.updatePolicy).toHaveBeenCalledWith("conn-7", topicArn, policy));
  });

  it("keeps SNS capability gating on the resource workspace", async () => {
    useS3AccountContextMock.mockReturnValue({
      accounts: [{ id: "conn-7", display_name: "Lab", storage_endpoint_capabilities: { sns: false } }],
      selectedS3AccountId: "conn-7",
      contextIdForApi: "conn-7",
      requiresS3AccountSelection: false,
      accessMode: "default",
    });
    renderWorkspace("/manager/topics/topic-events");

    expect(await screen.findByText("SNS topics are disabled for this endpoint")).toBeInTheDocument();
    expect(api.listTopics).not.toHaveBeenCalled();
  });
});
