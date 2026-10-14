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
    expect(managerText("Logical bytes", "fr")).toBe("Octets logiques");
    expect(managerText("Object versions are retained.", "fr")).toBe("Les versions des objets sont conservées.");
    expect(managerText("{count} keys", "fr", { count: 2 })).toBe("2 clés");
    expect(managerText("Topic '{name}' created.", "fr", { name: "events" })).toBe("Topic « events » créé.");
    expect(managerText("Valid JSON", "fr")).toBe("JSON valide");
    expect(managerText("IAM user details", "fr")).toBe("Détails de l’utilisateur IAM");
    expect(managerText("Role tags", "fr")).toBe("Tags du rôle");
  });

  it("preserves S3 and IAM technical literals", () => {
    expect(managerText("s3:GetObject", "fr")).toBe("s3:GetObject");
    expect(managerText("logs-bucket", "fr")).toBe("logs-bucket");
    expect(managerText("inline-policy", "fr")).toBe("inline-policy");
    expect(managerText("s3:GetObject", "de")).toBe("s3:GetObject");
    expect(managerText("s3:GetObject", "zh")).toBe("s3:GetObject");
  });

  it("uses German and Simplified Chinese Manager translations", () => {
    expect(managerText("Actions", "de")).toBe("Aktionen");
    expect(managerText("Actions", "zh")).toBe("操作");
    expect(managerText("Bucket", "de")).toBe("Bucket");
    expect(managerText("Bucket", "zh")).toBe("存储桶");
    expect(managerText("Versioning", "de")).toBe("Versionierung");
    expect(managerText("Versioning", "zh")).toBe("版本控制");
    expect(managerText("Lifecycle", "de")).toBe("Lebenszyklus");
    expect(managerText("Lifecycle", "zh")).toBe("生命周期");
    expect(managerText("View all {label}", "de", { label: "Benutzer" })).toBe("Alle Benutzer anzeigen");
    expect(managerText("View all {label}", "zh", { label: "用户" })).toBe("查看所有用户");
    expect(managerText("Quota status for {label}", "zh", { label: "存储" })).toBe("存储的配额状态");
    expect(managerText("Migration actions", "de")).toBe("Migrationsaktionen");
    expect(managerText("Migration actions", "zh")).toBe("迁移操作");
    expect(managerText("Source only ({count})", "de", { count: 3 })).toBe("Nur Quelle (3)");
    expect(managerText("Source only ({count})", "zh", { count: 3 })).toBe("仅源端 (3)");
    expect(managerText("Bucket name is required.", "de")).toBe("Bucket-Name ist erforderlich.");
    expect(managerText("Bucket name is required.", "zh")).toBe("必须填写存储桶名称。");
    expect(managerText("Delete bucket policy?", "de")).toBe("Bucket-Policy löschen?");
    expect(managerText("Delete bucket policy?", "zh")).toBe("删除存储桶策略？");
    expect(managerText("Logical bytes", "de")).toBe("Logische Bytes");
    expect(managerText("Logical bytes", "zh")).toBe("逻辑字节数");
    expect(managerText("Valid JSON", "de")).toBe("Gültiges JSON");
    expect(managerText("Valid JSON", "zh")).toBe("JSON 有效");
    expect(managerText("Maximum session duration (seconds)", "de")).toBe("Maximale Sitzungsdauer (Sekunden)");
    expect(managerText("IAM group details", "zh")).toBe("IAM 组详情");
    expect(managerText("S3 rejects new PUT ACLs that grant public access to buckets or objects.", "de"))
      .toContain("S3");
    expect(managerText("S3 rejects new PUT ACLs that grant public access to buckets or objects.", "zh"))
      .toContain("S3");
  });

  it("falls back to English when Manager copy is missing", () => {
    expect(managerText("Unknown Manager copy", "fr")).toBe("Unknown Manager copy");
    expect(managerText("Unknown Manager copy", "de")).toBe("Unknown Manager copy");
    expect(managerText("Unknown Manager copy", "zh")).toBe("Unknown Manager copy");
  });

  it("maps Manager formatting to the supported locale", () => {
    expect(managerIntlLocale("fr")).toBe("fr-FR");
    expect(managerIntlLocale("en")).toBe("en-US");
    expect(managerIntlLocale("de")).toBe("de-DE");
    expect(managerIntlLocale("zh")).toBe("zh-CN");
  });
});
