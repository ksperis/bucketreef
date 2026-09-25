import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import BucketNotificationsFeature from "../BucketNotificationsFeature";
import type { useBucketNotificationsController } from "../useBucketNotificationsController";

type NotificationsController = ReturnType<typeof useBucketNotificationsController>;

const supportedTopic = {
  Id: "uploads",
  TopicArn: "arn:aws:sns:default:acc-1:uploads",
  Events: ["s3:ObjectCreated:*", "s3:ObjectCreated:Put"],
  Filter: {
    Key: {
      FilterRules: [
        { Name: "prefix", Value: "uploads/" },
        { Name: "suffix", Value: ".json" },
      ],
    },
  },
};

function buildController(
  overrides: Partial<NotificationsController> = {},
): NotificationsController {
  return {
    addDraftTopic: vi.fn(),
    closeEditor: vi.fn(),
    configuration: {},
    configured: false,
    dirty: false,
    draftConfiguration: {},
    draftSignature: "{}",
    draftTopics: [],
    editorError: null,
    editorMode: "visual",
    editorOpen: false,
    error: null,
    hasAdvancedConfiguration: false,
    hasAdvancedDraftTopLevel: false,
    jsonText: "{}",
    load: vi.fn(),
    loading: false,
    openEditor: vi.fn(),
    openEditorFor: vi.fn(),
    openEditorWithNew: vi.fn(),
    openJsonEditor: vi.fn(),
    editorTargetIndex: null,
    removeDraftTopic: vi.fn(),
    removeTopicDirect: vi.fn(),
    saveDraft: vi.fn(),
    saving: false,
    status: null,
    topicCount: 0,
    topics: [],
    updateDraftTopic: vi.fn(),
    updateEditorMode: vi.fn(),
    updateJsonText: vi.fn(),
    ...overrides,
  } as NotificationsController;
}

function renderFeature(controller: NotificationsController) {
  return render(
    <MemoryRouter>
      <BucketNotificationsFeature controller={controller} />
    </MemoryRouter>,
  );
}

describe("BucketNotificationsFeature", () => {
  it("renders topic rows with direct edit and remove actions", async () => {
    const user = userEvent.setup();
    const controller = buildController({
      configuration: { TopicConfigurations: [supportedTopic] },
      configured: true,
      topicCount: 1,
      topics: [supportedTopic],
    });
    renderFeature(controller);

    const card = screen.getByTestId("bucket-feature-notifications");
    expect(card).toHaveAttribute("data-feature-state", "configured");
    expect(screen.getByText("1 topic notification")).toBeInTheDocument();
    expect(within(card).getByText("uploads")).toBeInTheDocument();
    expect(within(card).getByText("arn:aws:sns:default:acc-1:uploads")).toBeInTheDocument();
    expect(within(card).getByText(/s3:ObjectCreated:\*/)).toBeInTheDocument();
    expect(within(card).getByText("prefix=uploads/ · suffix=.json")).toBeInTheDocument();
    expect(within(card).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Remove" })).toBeEnabled();

    await user.click(within(card).getByRole("button", { name: "Edit" }));
    expect(controller.openEditorFor).toHaveBeenCalledWith(0);
    await user.click(within(card).getByRole("button", { name: "Remove" }));
    expect(controller.removeTopicDirect).toHaveBeenCalledWith(0);
  });

  it("renders an unconfigured notification collection with an add action", () => {
    renderFeature(buildController());

    const card = screen.getByTestId("bucket-feature-notifications");
    expect(within(card).getByText("0 topic notifications")).toBeInTheDocument();
    expect(within(card).getByText("No notifications configured on this bucket.")).toBeInTheDocument();
    expect(within(card).getByRole("table")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Add notification", exact: true })).toBeEnabled();
  });

  it("renders supported topics as editable cards and advanced topics as read-only", async () => {
    const user = userEvent.setup();
    const advancedTopic = {
      Id: "advanced",
      TopicArn: "arn:aws:sns:default:acc-1:advanced",
      Events: ["s3:ObjectRemoved:*"],
      CustomField: { keep: true },
    };
    const draftConfiguration = {
      TopicConfigurations: [supportedTopic, advancedTopic],
      QueueConfigurations: [{ Id: "queue-1" }],
    };
    const controller = buildController({
      configured: true,
      configuration: draftConfiguration,
      draftConfiguration,
      draftSignature: JSON.stringify(draftConfiguration),
      draftTopics: [supportedTopic, advancedTopic],
      editorOpen: true,
      hasAdvancedConfiguration: true,
      hasAdvancedDraftTopLevel: true,
      topicCount: 2,
      topics: [supportedTopic, advancedTopic],
    });
    renderFeature(controller);

    expect(screen.getByRole("heading", { name: "Edit bucket notifications" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Visual" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Topic ARN")).toHaveValue(
      "arn:aws:sns:default:acc-1:uploads",
    );
    expect(screen.getByRole("checkbox", { name: "All object created events" })).toBeChecked();
    expect(screen.getByText("s3:ObjectCreated:Put")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Add S3 event" })).toBeInTheDocument();
    expect(screen.getByText("Advanced notification — edit in JSON")).toBeInTheDocument();
    const eventInput = screen.getByRole("combobox", { name: "Add S3 event" });
    await user.type(eventInput, "ObjectRemoved:Delete");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(controller.updateDraftTopic).toHaveBeenCalledWith(0, {
      events: [
        "s3:ObjectCreated:*",
        "s3:ObjectCreated:Put",
        "s3:ObjectRemoved:Delete",
      ],
    });
    expect(screen.getAllByRole("button", { name: "Remove notification" })).toHaveLength(1);
    expect(screen.getByText(/Additional notification types or top-level fields/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add topic notification" }));
    expect(controller.addDraftTopic).toHaveBeenCalledOnce();
  });

  it("renders the complete JSON editor through the shared dialog", async () => {
    const user = userEvent.setup();
    const configuration = { TopicConfigurations: [supportedTopic] };
    const controller = buildController({
      configured: true,
      configuration,
      draftConfiguration: configuration,
      draftSignature: JSON.stringify(configuration),
      draftTopics: [supportedTopic],
      editorMode: "json",
      editorOpen: true,
      jsonText: JSON.stringify(configuration, null, 2),
      topicCount: 1,
      topics: [supportedTopic],
    });
    renderFeature(controller);

    expect(screen.getByRole("tab", { name: "JSON" })).toHaveAttribute("aria-selected", "true");
    const textarea = screen.getByLabelText("Notification configuration (JSON)");
    expect(textarea).toHaveValue(JSON.stringify(configuration, null, 2));
    await user.type(textarea, " ");
    expect(controller.updateJsonText).toHaveBeenCalled();
  });
});
