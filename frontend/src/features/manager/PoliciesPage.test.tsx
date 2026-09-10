import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import PoliciesPage from "./PoliciesPage";

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));
vi.mock("./S3AccountContext", () => ({ useS3AccountContext: () => ({
  selectedS3AccountType: "account", accountIdForApi: "acc-7", requiresS3AccountSelection: true, accessMode: "default",
}) }));
vi.mock("../../api/managerIamPolicies", () => ({ listIamPolicies: api.list, createIamPolicy: api.create }));

beforeEach(() => {
  vi.resetAllMocks();
  api.list.mockResolvedValue([{ name: "ReadOnly", arn: "arn:aws:iam::acc-7:policy/ReadOnly" }]);
  api.create.mockResolvedValue({ name: "New policy" });
});
async function open() {
  render(<MemoryRouter><PoliciesPage /></MemoryRouter>);
  await screen.findByText("ReadOnly");
  fireEvent.click(screen.getByRole("button", { name: "Create policy" }));
  return screen.getByRole("form", { name: "Create IAM policy" });
}

it("focuses missing names and invalid JSON, preserving the exact policy document", async () => {
  const form = await open();
  const name = within(form).getByLabelText("Policy name");
  const document = within(form).getByLabelText("Policy document (JSON)");
  fireEvent.submit(form);
  await waitFor(() => expect(name).toHaveFocus());
  expect(name).toHaveAccessibleDescription("Policy name is required.");
  fireEvent.change(name, { target: { value: " New policy " } });
  fireEvent.change(document, { target: { value: "" } });
  fireEvent.submit(form);
  await waitFor(() => expect(document).toHaveFocus());
  expect(document).toHaveAccessibleDescription(/Policy document must be valid JSON/);
  expect(api.create).not.toHaveBeenCalled();
  const policy = { Version: "2012-10-17", Statement: [{ Effect: "Deny", Action: "s3:DeleteObject", Resource: "*" }] };
  fireEvent.change(document, { target: { value: JSON.stringify(policy) } });
  expect(document).not.toHaveAttribute("aria-invalid", "true");
  fireEvent.submit(form);
  await waitFor(() => expect(api.create).toHaveBeenCalledWith("acc-7", "New policy", policy));
  await waitFor(() => expect(form).not.toBeInTheDocument());
});

it("freezes the pending draft, ignores duplicate submission and retries after failure", async () => {
  let reject!: (error: Error) => void;
  api.create.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const form = await open();
  fireEvent.change(within(form).getByLabelText("Policy name"), { target: { value: "New policy" } });
  fireEvent.submit(form);
  expect(within(form).getByLabelText("Policy name")).toBeDisabled();
  expect(within(form).getByLabelText("Policy document (JSON)")).toBeDisabled();
  expect(within(form).getByRole("button", { name: "Cancel" })).toBeDisabled();
  fireEvent.submit(form);
  fireEvent.click(screen.getByRole("button", { name: "Back to policies" }));
  expect(api.create).toHaveBeenCalledOnce();
  expect(form).toBeInTheDocument();
  await act(async () => reject(new Error("Policy creation failed")));
  await within(form.closest(".workflow-page")!).findByText("Policy creation failed");
  expect(within(form).getByLabelText("Policy name")).toHaveValue("New policy");
  fireEvent.submit(form);
  await waitFor(() => expect(form).not.toBeInTheDocument());
  expect(api.create.mock.calls[1]).toEqual(api.create.mock.calls[0]);
});

it("keeps or discards the draft through the shared close confirmation", async () => {
  const form = await open();
  fireEvent.change(within(form).getByLabelText("Policy name"), { target: { value: "Draft" } });
  fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep editing" }));
  expect(within(form).getByLabelText("Policy name")).toHaveValue("Draft");
  fireEvent.click(screen.getByRole("button", { name: "Back to policies" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Discard changes" }));
  expect(form).not.toBeInTheDocument();
  expect(api.create).not.toHaveBeenCalled();
});
