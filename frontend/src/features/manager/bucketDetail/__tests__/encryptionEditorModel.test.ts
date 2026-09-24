import { describe, expect, it } from "vitest";
import {
  createVisualEncryptionRule,
  isEncryptionRuleVisuallyEditable,
  parseEncryptionRulesJson,
  readEncryptionVisualRule,
  updateEncryptionVisualRule,
} from "../encryptionEditorModel";

describe("encryptionEditorModel", () => {
  it("recognizes the supported AES256 and SSE-KMS rule shapes", () => {
    expect(isEncryptionRuleVisuallyEditable(createVisualEncryptionRule())).toBe(true);
    expect(
      isEncryptionRuleVisuallyEditable({
        ApplyServerSideEncryptionByDefault: {
          SSEAlgorithm: "aws:kms",
          KMSMasterKeyID: "key-1",
        },
        BucketKeyEnabled: true,
      }),
    ).toBe(true);
  });

  it("keeps unsupported or semantically incompatible structures advanced", () => {
    expect(
      isEncryptionRuleVisuallyEditable({
        ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms:dsse" },
      }),
    ).toBe(false);
    expect(
      isEncryptionRuleVisuallyEditable({
        ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
        BucketKeyEnabled: true,
      }),
    ).toBe(false);
    expect(
      isEncryptionRuleVisuallyEditable({
        ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
        CustomProviderField: { keep: true },
      }),
    ).toBe(false);
  });

  it("updates supported fields without dropping untouched optional structure", () => {
    const original = {
      ApplyServerSideEncryptionByDefault: {
        SSEAlgorithm: "aws:kms",
        KMSMasterKeyID: "key-1",
      },
    };

    const withBucketKey = updateEncryptionVisualRule(original, {
      bucketKeyState: "enabled",
    });
    expect(withBucketKey).toEqual({
      ApplyServerSideEncryptionByDefault: {
        SSEAlgorithm: "aws:kms",
        KMSMasterKeyID: "key-1",
      },
      BucketKeyEnabled: true,
    });
    expect(readEncryptionVisualRule(withBucketKey)).toEqual({
      algorithm: "aws:kms",
      kmsKeyId: "key-1",
      bucketKeyState: "enabled",
    });

    expect(updateEncryptionVisualRule(withBucketKey, { algorithm: "AES256" })).toEqual({
      ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
    });
  });

  it("never rewrites an advanced rule through the visual update helper", () => {
    const advanced = {
      ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms" },
      CustomProviderField: { keep: true },
    };

    const updated = updateEncryptionVisualRule(advanced, { bucketKeyState: "enabled" });
    expect(updated).toBe(advanced);
    expect(updated).toEqual(advanced);
  });

  it("validates the JSON container while preserving advanced rule objects", () => {
    const advanced = {
      ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms:dsse" },
      CustomProviderField: { keep: true },
    };
    expect(parseEncryptionRulesJson(JSON.stringify([advanced]))).toEqual({
      rules: [advanced],
      error: null,
    });
    expect(parseEncryptionRulesJson("{}")).toEqual({
      rules: null,
      error: "Encryption JSON must be an array of rules.",
    });
    expect(parseEncryptionRulesJson("[1]")).toEqual({
      rules: null,
      error: "Each encryption rule must be a JSON object.",
    });
    expect(parseEncryptionRulesJson("[")).toEqual({
      rules: null,
      error: "Encryption rules JSON is invalid.",
    });
  });
});
