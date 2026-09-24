import { describe, expect, it } from "vitest";
import {
  isCorsRuleVisuallyEditable,
  parseCorsRulesJson,
  readCorsVisualRule,
  updateCorsVisualRule,
  validateVisualCorsRules,
} from "../corsEditorModel";

describe("corsEditorModel", () => {
  it("reads and updates the complete supported CORS subset", () => {
    const rule = {
      ID: "browser",
      AllowedOrigins: ["https://app.example.com"],
      AllowedMethods: ["GET", "PUT"],
      AllowedHeaders: ["Content-Type"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 600,
    };

    expect(isCorsRuleVisuallyEditable(rule)).toBe(true);
    expect(readCorsVisualRule(rule)).toMatchObject({
      id: "browser",
      allowedMethods: ["GET", "PUT"],
      maxAgeSeconds: "600",
    });
    expect(updateCorsVisualRule(rule, {
      allowedOrigins: ["https://new.example"],
      maxAgeSeconds: "1200",
    })).toEqual({
      ...rule,
      AllowedOrigins: ["https://new.example"],
      MaxAgeSeconds: 1200,
    });
  });

  it("marks unknown structures advanced and never rewrites them visually", () => {
    const advanced = {
      AllowedOrigins: ["*"],
      AllowedMethods: ["GET"],
      CustomExtension: { keep: true },
    };

    expect(isCorsRuleVisuallyEditable(advanced)).toBe(false);
    expect(updateCorsVisualRule(advanced, { allowedOrigins: ["https://changed.example"] })).toBe(advanced);
  });

  it("parses only arrays of JSON objects", () => {
    expect(parseCorsRulesJson("{}").error).toBe("CORS JSON must be an array of rules.");
    expect(parseCorsRulesJson("[1]").error).toBe("Each CORS rule must be a JSON object.");
    expect(parseCorsRulesJson('[{"AllowedOrigins":["*"]}]').rules).toEqual([
      { AllowedOrigins: ["*"] },
    ]);
  });

  it("validates required origins, methods, optional headers and max age", () => {
    expect(validateVisualCorsRules([{ AllowedOrigins: [""], AllowedMethods: ["GET"] }])).toMatch(/origins/);
    expect(validateVisualCorsRules([{ AllowedOrigins: ["*"], AllowedMethods: [] }])).toMatch(/method/);
    expect(validateVisualCorsRules([{ AllowedOrigins: ["*"], AllowedMethods: ["GET"], AllowedHeaders: [""] }])).toMatch(/headers/);
    expect(validateVisualCorsRules([{ AllowedOrigins: ["*"], AllowedMethods: ["GET"], MaxAgeSeconds: 1.5 }])).toMatch(/max age/);
    expect(validateVisualCorsRules([{ AllowedOrigins: ["*"], AllowedMethods: ["GET"], MaxAgeSeconds: 3600 }])).toBeNull();
  });
});
