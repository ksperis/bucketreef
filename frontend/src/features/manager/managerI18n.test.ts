/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { describe, expect, it } from "vitest";
import { managerIntlLocale, managerText } from "./managerI18n";

describe("Manager i18n", () => {
  it("uses French translations and interpolates values", () => {
    expect(managerText("Manager", "fr")).toBe("Manager");
    expect(managerText("Bucket {name}", "fr", { name: "research" })).toBe("Bucket research");
    expect(managerText("Buckets", "fr")).toBe("Buckets");
    expect(managerText("Versioning", "fr")).toBe("Gestion des versions");
    expect(managerText("Lifecycle", "fr")).toBe("Cycle de vie");
    expect(managerText("Destination bucket ARN", "fr")).toBe("ARN du bucket de destination");
    expect(managerText("Add tag", "fr")).toBe("Ajouter un tag");
    expect(managerText("Bucket {name}", "fr", { name: "research" })).toBe("Bucket research");
  });

  it("preserves S3 and IAM technical literals", () => {
    expect(managerText("s3:GetObject", "fr")).toBe("s3:GetObject");
    expect(managerText("logs-bucket", "fr")).toBe("logs-bucket");
    expect(managerText("inline-policy", "fr")).toBe("inline-policy");
  });

  it("keeps English as the fallback for untranslated Manager languages", () => {
    expect(managerText("Manager", "de")).toBe("Manager");
    expect(managerText("Manager", "zh")).toBe("Manager");
    expect(managerText("Unknown Manager copy", "fr")).toBe("Unknown Manager copy");
  });

  it("maps Manager formatting to the supported locale", () => {
    expect(managerIntlLocale("fr")).toBe("fr-FR");
    expect(managerIntlLocale("en")).toBe("en-US");
    expect(managerIntlLocale("de")).toBe("en-US");
    expect(managerIntlLocale("zh")).toBe("en-US");
  });
});
