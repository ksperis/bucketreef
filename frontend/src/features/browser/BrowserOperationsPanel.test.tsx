import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "../../components/language";
import { setSessionUserCache } from "../../utils/workspaces";
import BrowserOperationsPanel from "./BrowserOperationsPanel";

afterEach(() => {
  cleanup();
  setSessionUserCache(null);
  localStorage.clear();
});

describe("BrowserOperationsPanel", () => {
  it("localizes the dominant completed status", () => {
    setSessionUserCache({ role: "ui_user", authType: "password", ui_language: "fr" });

    render(
      <LanguageProvider>
        <BrowserOperationsPanel
          open={false}
          totalOperationsCount={1}
          activeOperationsCount={0}
          queuedOperationsCount={0}
          completedOperationsCount={1}
          failedOperationsCount={0}
          downloadGroups={[]}
          deleteGroups={[]}
          copyGroups={[]}
          uploadGroups={[]}
          otherOperations={[]}
          operationSortIndexById={{}}
          uploadGroupSortIndexById={{}}
          operationSortFallback={0}
          cancelOperation={vi.fn()}
          cancelUploadGroup={vi.fn()}
          hasFinishedOperations
          canDismiss
          onClearFinishedOperations={vi.fn()}
          onDismiss={vi.fn()}
          onOpenDetails={vi.fn()}
          onToggleOpen={vi.fn()}
        />
      </LanguageProvider>,
    );

    expect(screen.getByText("Terminé", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("Completed", { exact: true })).not.toBeInTheDocument();
  });
});
