import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import ManagerIamArnField from "./ManagerIamArnField";

const clipboard = vi.hoisted(() => ({ copy: vi.fn() }));

vi.mock("../../utils/clipboard", () => ({ copyTextToClipboard: clipboard.copy }));

beforeEach(() => {
  vi.resetAllMocks();
  clipboard.copy.mockResolvedValue(undefined);
});

it("copies the ARN and announces success", async () => {
  render(<ManagerIamArnField arn="arn:aws:iam::7:user/alice" />);

  fireEvent.click(screen.getByRole("button", { name: "Copy ARN" }));

  await waitFor(() => expect(clipboard.copy).toHaveBeenCalledWith("arn:aws:iam::7:user/alice"));
  expect(await screen.findByRole("status")).toHaveTextContent("ARN copied");
});

it("keeps the ARN visible and announces clipboard failures", async () => {
  clipboard.copy.mockRejectedValueOnce(new Error("blocked"));
  render(<ManagerIamArnField arn="arn:aws:iam::7:group/research" />);

  fireEvent.click(screen.getByRole("button", { name: "Copy ARN" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to copy ARN.");
  expect(screen.getByLabelText("ARN")).toHaveValue("arn:aws:iam::7:group/research");
});
