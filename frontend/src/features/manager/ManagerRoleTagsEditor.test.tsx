import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { IAMTag } from "../../api/managerIamRoles";
import ManagerRoleTagsEditor from "./ManagerRoleTagsEditor";

function Harness() {
  const [tags, setTags] = useState<IAMTag[]>([
    { key: "team", value: "storage" },
    { key: "environment", value: "production" },
  ]);
  return <ManagerRoleTagsEditor tags={tags} onChange={setTags} />;
}

describe("ManagerRoleTagsEditor", () => {
  it("keeps the surviving tag input mounted when an earlier tag is removed", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const secondKeyInput = screen.getAllByLabelText("Tag key")[1];
    expect(secondKeyInput).toHaveValue("environment");

    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);

    const remainingKeyInput = screen.getByLabelText("Tag key");
    expect(remainingKeyInput).toBe(secondKeyInput);
    expect(remainingKeyInput).toHaveValue("environment");
  });
});
