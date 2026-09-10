import { describe, expect, it } from "vitest";

import { formInlineActionClasses, formInlineDeleteClasses } from "./formInlineActionClasses";

describe("formInlineActionClasses", () => {
  it("defines explicit disabled styles for regular action buttons", () => {
    expect(formInlineActionClasses).toContain("disabled:cursor-not-allowed");
    expect(formInlineActionClasses).toContain("disabled:border-slate-200");
    expect(formInlineActionClasses).toContain("disabled:text-slate-400");
    expect(formInlineActionClasses).toContain("disabled:hover:text-slate-400");
    expect(formInlineActionClasses).toContain("dark:disabled:text-slate-500");
  });

  it("defines explicit disabled styles for delete action buttons", () => {
    expect(formInlineDeleteClasses).toContain("disabled:cursor-not-allowed");
    expect(formInlineDeleteClasses).toContain("disabled:border-slate-200");
    expect(formInlineDeleteClasses).toContain("disabled:text-slate-400");
    expect(formInlineDeleteClasses).toContain("disabled:hover:bg-transparent");
    expect(formInlineDeleteClasses).toContain("dark:disabled:text-slate-500");
  });
});
