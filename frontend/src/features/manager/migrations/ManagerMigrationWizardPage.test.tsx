import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerMigrationWizardPage from "./ManagerMigrationWizardPage";

const listExecutionContextsMock = vi.fn();
const listBucketsMock = vi.fn();
const createManagerMigrationMock = vi.fn();
const runManagerMigrationPrecheckMock = vi.fn();
const startManagerMigrationMock = vi.fn();

vi.mock("../../../api/executionContexts", () => ({
  listExecutionContexts: (...args: unknown[]) =>
    listExecutionContextsMock(...args),
}));

vi.mock("../../../api/managerBuckets", () => ({
  listBuckets: (...args: unknown[]) => listBucketsMock(...args),
}));

vi.mock("../../../api/managerMigrations", async () => {
  const actual = await vi.importActual("../../../api/managerMigrations");
  return {
    ...actual,
    createManagerMigration: (...args: unknown[]) =>
      createManagerMigrationMock(...args),
    updateManagerMigration: vi.fn(),
    getManagerMigration: vi.fn(),
    runManagerMigrationPrecheck: (...args: unknown[]) =>
      runManagerMigrationPrecheckMock(...args),
    startManagerMigration: (...args: unknown[]) =>
      startManagerMigrationMock(...args),
  };
});

vi.mock("../S3AccountContext", () => ({
  useS3AccountContext: () => ({
    selectedS3AccountId: "src-ctx",
  }),
}));

function DestinationProbe() {
  const params = useParams<{ migrationId: string }>();
  return <p>detail-{params.migrationId}</p>;
}

function setup() {
  return render(
    <MemoryRouter initialEntries={["/manager/migrations/new"]}>
      <Routes>
        <Route
          path="/manager/migrations/new"
          element={<ManagerMigrationWizardPage />}
        />
        <Route
          path="/manager/migrations/:migrationId"
          element={<DestinationProbe />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function selectBucket(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("option", { name: "Target (tgt-ctx)" });
  await user.selectOptions(
    screen.getByLabelText("Destination context"),
    "tgt-ctx",
  );
  await user.click(screen.getByRole("checkbox", { name: "Select bucket-a" }));
}

describe("ManagerMigrationWizardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listExecutionContextsMock.mockResolvedValue([
      {
        id: "src-ctx",
        kind: "account",
        manager_role: "account_administrator",
        display_name: "Source",
        endpoint_id: 1,
      },
      {
        id: "tgt-ctx",
        kind: "account",
        manager_role: "account_administrator",
        display_name: "Target",
        endpoint_id: 2,
      },
    ]);
    listBucketsMock.mockImplementation((id: string) =>
      Promise.resolve(id === "src-ctx" ? [{ name: "bucket-a" }] : []),
    );
    createManagerMigrationMock.mockResolvedValue({
      id: 77,
      configuration_revision: 1,
    });
    runManagerMigrationPrecheckMock.mockResolvedValue({
      id: 77,
      preparation_status: "checking",
    });
  });

  it("has no a11y violations with editable target names", async () => {
    const user = userEvent.setup();
    const { container } = setup();
    await selectBucket(user);
    expect((await axe(container)).violations).toEqual([]);
  });

  it("prepares inline mappings and queues only read-only checks", async () => {
    const user = userEvent.setup();
    setup();
    await selectBucket(user);
    const field = screen.getByRole("textbox", {
      name: "Destination name for bucket-a",
    });
    await user.clear(field);
    await user.type(field, "new-bucket");
    await user.click(screen.getByRole("button", { name: "Check migration" }));
    await screen.findByText("detail-77");
    expect(createManagerMigrationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source_context_id: "src-ctx",
        target_context_id: "tgt-ctx",
        buckets: [{ source_bucket: "bucket-a", target_bucket: "new-bucket" }],
        mode: "pre_sync",
        delete_source: false,
        auto_grant_source_read_for_copy: false,
      }),
    );
    expect(runManagerMigrationPrecheckMock).toHaveBeenCalledWith(77, false);
    expect(startManagerMigrationMock).not.toHaveBeenCalled();
  });

  it("keeps the saved draft and entered names when queuing checks fails", async () => {
    const user = userEvent.setup();
    setup();
    await selectBucket(user);
    runManagerMigrationPrecheckMock.mockRejectedValue(
      new Error("Network unavailable"),
    );
    await user.click(screen.getByRole("button", { name: "Check migration" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Draft #77 is saved",
    );
    expect(screen.getByRole("link", { name: "Open checks" })).toHaveAttribute(
      "href",
      "/manager/migrations/77",
    );
    expect(
      screen.getByRole("textbox", { name: "Destination name for bucket-a" }),
    ).toHaveValue("bucket-a");
    expect(startManagerMigrationMock).not.toHaveBeenCalled();
  });

  it("shows invalid destination corrections and focuses the error summary", async () => {
    const user = userEvent.setup();
    setup();
    await selectBucket(user);
    const field = screen.getByRole("textbox", {
      name: "Destination name for bucket-a",
    });
    await user.clear(field);
    await user.type(field, "Invalid Name");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAttribute("aria-describedby");
    await user.click(screen.getByRole("button", { name: "Check migration" }));
    expect(createManagerMigrationMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").parentElement).toHaveFocus();
  });

  it("blocks known existing destinations", async () => {
    listBucketsMock.mockResolvedValue([{ name: "bucket-a" }]);
    const user = userEvent.setup();
    setup();
    await selectBucket(user);
    expect(
      await screen.findByText("Destination already exists. Choose a new name."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check migration" }));
    expect(createManagerMigrationMock).not.toHaveBeenCalled();
  });

  it("keeps bucket selection and mapping on the same screen", async () => {
    listBucketsMock.mockImplementation((id: string) =>
      Promise.resolve(
        id === "src-ctx" ? [{ name: "bucket-a" }, { name: "logs-prod" }] : [],
      ),
    );
    const user = userEvent.setup();
    setup();
    await screen.findByRole("checkbox", { name: "Select logs-prod" });
    await user.type(screen.getByLabelText("Filter source buckets"), "prod");
    await user.click(screen.getByRole("button", { name: "Select filtered" }));
    expect(
      screen.getByRole("textbox", { name: "Destination name for logs-prod" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("checkbox", { name: "Select bucket-a" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(
      screen.getByRole("textbox", { name: "Destination name for logs-prod" }),
    ).toBeDisabled();
  });

  it("does not implicitly enable grants when selecting storage copy", async () => {
    listExecutionContextsMock.mockResolvedValue([
      {
        id: "src-ctx",
        kind: "account",
        manager_role: "account_administrator",
        display_name: "Source",
        endpoint_id: 1,
      },
      {
        id: "tgt-ctx",
        kind: "account",
        manager_role: "account_administrator",
        display_name: "Target",
        endpoint_id: 1,
      },
    ]);
    const user = userEvent.setup();
    setup();
    await selectBucket(user);
    await user.click(screen.getByText("Advanced options"));
    await user.click(
      screen.getByRole("radio", { name: /Copy within storage/ }),
    );
    expect(
      screen.getByRole("checkbox", {
        name: "Allow temporary source read grants for the destination identity",
      }),
    ).not.toBeChecked();
  });

  it("protects an edited draft when canceling", async () => {
    const user = userEvent.setup();
    setup();
    await selectBucket(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(createManagerMigrationMock).not.toHaveBeenCalled();
  });

  it("filters account destinations without administrator access", async () => {
    listExecutionContextsMock.mockResolvedValue([
      {
        id: "src-ctx",
        kind: "account",
        manager_role: "account_administrator",
        display_name: "Source",
        endpoint_id: 1,
      },
      {
        id: "no-admin",
        kind: "account",
        manager_role: null,
        display_name: "Forbidden",
        endpoint_id: 2,
      },
      {
        id: "conn-7",
        kind: "connection",
        display_name: "Shared connection",
        endpoint_id: 2,
      },
    ]);
    setup();
    await screen.findByRole("option", { name: /Shared connection/ });
    expect(
      screen.queryByRole("option", { name: /Forbidden/ }),
    ).not.toBeInTheDocument();
  });
});
