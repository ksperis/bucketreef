/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import { iamNameFormatError, inlinePolicyNameFormatError, rgwUserUidFormatError, topicNameFormatError, type IAMEntity, type NamingValidationProfile } from "./resourceNames";
import { managerText } from "../features/manager/managerI18n";
import { isValidS3BucketName } from "./s3BucketName";

type Vector = { kind: string; value: string; valid: boolean; entity?: IAMEntity; profile?: NamingValidationProfile; tenant?: string };
const vectors: Vector[] = JSON.parse(readFileSync(new NodeURL("../../../backend/tests/fixtures/resource_names.json", import.meta.url), "utf8"));

describe("shared UI/API naming contracts", () => {
  it.each(vectors)("$kind $entity $profile: $value → $valid", ({ kind, value, valid, entity, profile, tenant }) => {
    const error = kind === "iam" ? iamNameFormatError(value, entity!)
      : kind === "inline" ? inlinePolicyNameFormatError(value, entity!, profile!)
      : kind === "uid" ? rgwUserUidFormatError(value, tenant)
      : kind === "bucket" ? !isValidS3BucketName(value) : topicNameFormatError(value);
    expect(!error).toBe(valid);
  });

  it("defers required-field errors to submission and translates format guidance", () => {
    expect(iamNameFormatError("", "user")).toBeUndefined();
    expect(inlinePolicyNameFormatError("", "user", "ceph")).toBeUndefined();
    expect(rgwUserUidFormatError("")).toBeUndefined();
    expect(topicNameFormatError("")).toBeUndefined();
    for (const locale of ["fr", "de", "zh"] as const) {
      for (const message of [iamNameFormatError("*", "user"), iamNameFormatError("*", "group"), inlinePolicyNameFormatError("_", "group", "ceph"), topicNameFormatError("*")]) {
        expect(managerText(message!, locale)).not.toBe(message);
      }
    }
  });
});
