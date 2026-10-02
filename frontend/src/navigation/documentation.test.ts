import { describe, expect, it } from "vitest";

import { resolveDocumentationUrl } from "./documentation";

describe("documentation navigation", () => {
  it("keeps Browser help in the active host guide", () => {
    expect(resolveDocumentationUrl("/browser", { topic: "browser-operations" })).toBe(
      "https://docs.bucketreef.ksperis.com/browser/en/objects/operations/",
    );
    expect(resolveDocumentationUrl("/manager/browser", { topic: "browser-operations" })).toBe(
      "https://docs.bucketreef.ksperis.com/manager/en/browser/object-operations/",
    );
    expect(resolveDocumentationUrl("/portal/storage-spaces/42", { topic: "browser-versions" })).toBe(
      "https://docs.bucketreef.ksperis.com/portal/en/files/versions/",
    );
    expect(resolveDocumentationUrl("/ceph-admin/browser", { topic: "browser-operations" })).toBe(
      "https://docs.bucketreef.ksperis.com/admin/en/storage/browser-operations/",
    );
  });

  it("resolves contextual pages for each workspace", () => {
    expect(resolveDocumentationUrl("/admin/production-readiness")).toBe(
      "https://docs.bucketreef.ksperis.com/admin/en/operations/production-checks/",
    );
    expect(resolveDocumentationUrl("/manager/buckets/example")).toBe(
      "https://docs.bucketreef.ksperis.com/manager/en/buckets/",
    );
    expect(resolveDocumentationUrl("/portal/storage-spaces")).toBe(
      "https://docs.bucketreef.ksperis.com/portal/en/spaces/",
    );
    expect(resolveDocumentationUrl("/portal/storage-spaces/example")).toBe(
      "https://docs.bucketreef.ksperis.com/portal/en/files/",
    );
    expect(resolveDocumentationUrl("/storage-ops/buckets/example")).toBe(
      "https://docs.bucketreef.ksperis.com/admin/en/storage/storage-ops/",
    );
  });

  it("uses French Portal documentation and falls back for guides without translations", () => {
    expect(resolveDocumentationUrl("/portal", { language: "fr" })).toBe(
      "https://docs.bucketreef.ksperis.com/portal/fr/",
    );
    expect(resolveDocumentationUrl("/portal/storage-spaces/demo", { language: "fr" })).toBe(
      "https://docs.bucketreef.ksperis.com/portal/fr/files/",
    );
    expect(
      resolveDocumentationUrl("/portal/storage-spaces/demo", {
        language: "fr",
        topic: "browser-versions",
      }),
    ).toBe("https://docs.bucketreef.ksperis.com/portal/fr/files/versions/");
    expect(resolveDocumentationUrl("/manager", { language: "fr" })).toBe(
      "https://docs.bucketreef.ksperis.com/manager/en/",
    );
  });

  it("does not invent documentation for non-workspace routes", () => {
    expect(resolveDocumentationUrl("/login")).toBeNull();
    expect(resolveDocumentationUrl("/unknown/path")).toBeNull();
  });
});
