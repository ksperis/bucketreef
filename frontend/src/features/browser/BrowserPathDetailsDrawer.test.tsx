import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import BrowserPathDetailsDrawer from "./BrowserPathDetailsDrawer";

describe("BrowserPathDetailsDrawer", () => {
  it.each(["/", "//", "/reports//", " reports // nested /"])(
    "counts the exact prefix %j rather than a normalized neighbor",
    async (prefix) => {
      const user = userEvent.setup();
      const listAllObjectsForPrefix = vi.fn().mockResolvedValue([]);
      const onCopyPath = vi.fn();
      render(
        <BrowserPathDetailsDrawer
          accountId="account-1"
          bucketName="documents"
          listAllObjectsForPrefix={listAllObjectsForPrefix}
          prefix={prefix}
          versioningEnabled={false}
          onClose={vi.fn()}
          onCopyPath={onCopyPath}
        />,
      );

      expect(screen.getByText("Folder prefix")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Count contents" }));
      await waitFor(() => expect(listAllObjectsForPrefix).toHaveBeenCalledWith(prefix));
      await user.click(screen.getByRole("button", { name: "Copy path" }));
      expect(onCopyPath).toHaveBeenCalledWith(`documents/${prefix.slice(0, -1)}`);
    },
  );

  it("runs the recursive content count only when requested", async () => {
    const user = userEvent.setup();
    const listAllObjectsForPrefix = vi.fn().mockResolvedValue([
      { key: "reports/a.txt", size: 10 },
      { key: "reports/nested/b.txt", size: 20 },
    ]);

    render(
      <BrowserPathDetailsDrawer
        accountId="account-1"
        bucketName="documents"
        listAllObjectsForPrefix={listAllObjectsForPrefix}
        prefix="reports/"
        requestOptions={{ workspaceSurface: "browser" }}
        versioningEnabled={false}
        onClose={vi.fn()}
        onCopyPath={vi.fn()}
      />,
    );

    expect(screen.getByText("Recursive contents")).toBeInTheDocument();
    expect(listAllObjectsForPrefix).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Count contents" }));

    await waitFor(() => {
      expect(listAllObjectsForPrefix).toHaveBeenCalledWith("reports/");
    });
    expect(screen.getByText("Current objects")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Count again" }),
    ).toBeInTheDocument();
  });

  it("normalizes the bucket root to an empty recursive prefix", async () => {
    const user = userEvent.setup();
    const listAllObjectsForPrefix = vi.fn().mockResolvedValue([]);

    render(
      <BrowserPathDetailsDrawer
        accountId="account-1"
        bucketName="documents"
        listAllObjectsForPrefix={listAllObjectsForPrefix}
        prefix=""
        versioningEnabled={false}
        onClose={vi.fn()}
        onCopyPath={vi.fn()}
      />,
    );

    expect(screen.getByRole("complementary", { name: "Bucket root" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Count contents" }));
    await waitFor(() => expect(listAllObjectsForPrefix).toHaveBeenCalledWith(""));
  });
});
