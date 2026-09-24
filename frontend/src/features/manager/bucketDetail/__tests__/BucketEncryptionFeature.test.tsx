import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import BucketEncryptionFeature from "../BucketEncryptionFeature";
import type { useBucketEncryptionController } from "../useBucketEncryptionController";

type EncryptionController = ReturnType<typeof useBucketEncryptionController>;

const aesRule = {
  ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
};
const kmsRule = {
  ApplyServerSideEncryptionByDefault: {
    SSEAlgorithm: "aws:kms",
    KMSMasterKeyID: "kms-key-1",
  },
  BucketKeyEnabled: true,
};

function buildController(
  overrides: Partial<EncryptionController> = {},
): EncryptionController {
  return {
    addDraftRule: vi.fn(),
    closeEditor: vi.fn(),
    configured: false,
    dirty: false,
    draftRules: [],
    draftSignature: "[]",
    editorError: null,
    editorMode: "visual",
    editorOpen: false,
    error: null,
    jsonText: "[]",
    load: vi.fn(),
    loading: false,
    openEditor: vi.fn(),
    removeDraftRule: vi.fn(),
    ruleCount: 0,
    rules: [],
    saveDraft: vi.fn(),
    saving: false,
    status: null,
    updateDraftRule: vi.fn(),
    updateEditorMode: vi.fn(),
    updateJsonText: vi.fn(),
    ...overrides,
  } as EncryptionController;
}

function renderFeature(controller: EncryptionController, enabled = true) {
  return render(
    <MemoryRouter>
      <BucketEncryptionFeature controller={controller} enabled={enabled} />
    </MemoryRouter>,
  );
}

describe("BucketEncryptionFeature", () => {
  it("renders a compact read-only encryption summary with a single Edit action", async () => {
    const user = userEvent.setup();
    const controller = buildController({
      configured: true,
      ruleCount: 2,
      rules: [aesRule, kmsRule],
    });
    renderFeature(controller);

    const section = screen.getByTestId("bucket-feature-encryption");
    expect(section).toHaveAttribute("data-feature-state", "configured");
    expect(screen.getByText("Enabled · 2 rules")).toBeInTheDocument();
    expect(within(section).getByText("AES256")).toBeInTheDocument();
    expect(within(section).getByText("aws:kms")).toBeInTheDocument();
    expect(within(section).getByText("kms-key-1")).toBeInTheDocument();
    expect(within(section).getByText("Enabled")).toBeInTheDocument();
    expect(within(section).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: /remove|disable|save/i })).not.toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "Edit" }));
    expect(controller.openEditor).toHaveBeenCalledOnce();
  });

  it("keeps an unconfigured encryption summary compact and configurable", () => {
    renderFeature(buildController());

    const section = screen.getByTestId("bucket-feature-encryption");
    expect(within(section).queryByText("Disabled · 0 rules")).not.toBeInTheDocument();
    expect(within(section).queryByText("Default bucket encryption is disabled.")).not.toBeInTheDocument();
    expect(within(section).queryByRole("table")).not.toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Configure" })).toBeEnabled();
  });

  it("edits supported KMS rules visually and keeps advanced rules read-only", async () => {
    const user = userEvent.setup();
    const advancedRule = {
      ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms:dsse" },
      CustomProviderField: { keep: true },
    };
    const controller = buildController({
      configured: true,
      draftRules: [kmsRule, advancedRule],
      draftSignature: JSON.stringify([kmsRule, advancedRule]),
      editorOpen: true,
      ruleCount: 2,
      rules: [kmsRule, advancedRule],
    });
    renderFeature(controller);

    const dialog = screen.getByRole("dialog", { name: "Edit server-side encryption" });
    expect(within(dialog).getByRole("tab", { name: "Visual" })).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByLabelText("Encryption algorithm")).toHaveValue("aws:kms");
    expect(within(dialog).getByLabelText("KMS key ID (optional)")).toHaveValue("kms-key-1");
    expect(within(dialog).getByLabelText("S3 bucket key")).toHaveValue("enabled");

    const advanced = within(dialog).getByTestId("encryption-advanced-rule");
    expect(within(advanced).getByText("Advanced rule — edit in JSON")).toBeInTheDocument();
    expect(within(advanced).queryByRole("button", { name: "Remove rule" })).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: "Remove rule" })).toHaveLength(1);

    await user.selectOptions(within(dialog).getByLabelText("Encryption algorithm"), "AES256");
    expect(controller.updateDraftRule).toHaveBeenCalledWith(0, { algorithm: "AES256" });
    await user.click(within(dialog).getByRole("button", { name: "Add rule" }));
    expect(controller.addDraftRule).toHaveBeenCalledOnce();
  });

  it("renders the complete JSON editor through the shared dialog", async () => {
    const user = userEvent.setup();
    const rules = [kmsRule];
    const controller = buildController({
      configured: true,
      draftRules: rules,
      draftSignature: JSON.stringify(rules),
      editorMode: "json",
      editorOpen: true,
      jsonText: JSON.stringify(rules, null, 2),
      ruleCount: 1,
      rules,
    });
    renderFeature(controller);

    expect(screen.getByRole("tab", { name: "JSON" })).toHaveAttribute("aria-selected", "true");
    const textarea = screen.getByLabelText("Encryption rules (JSON)");
    expect(textarea).toHaveValue(JSON.stringify(rules, null, 2));
    await user.type(textarea, " ");
    expect(controller.updateJsonText).toHaveBeenCalled();
  });

  it("preserves the endpoint-disabled state and prevents opening the editor", () => {
    renderFeature(buildController(), false);

    const section = screen.getByTestId("bucket-feature-encryption");
    expect(section).toHaveAttribute("data-feature-state", "disabled");
    expect(within(section).getByText("Server-side encryption is disabled on this endpoint.")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Edit" })).toBeDisabled();
  });
});
