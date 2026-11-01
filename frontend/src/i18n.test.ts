import { describe, expect, it } from "vitest";
import { intlLocale } from "./i18n";

describe("intlLocale", () => {
  it("maps supported UI languages to Intl locales", () => {
    expect(intlLocale("en")).toBe("en-US");
    expect(intlLocale("fr")).toBe("fr-FR");
    expect(intlLocale("de")).toBe("de-DE");
    expect(intlLocale("zh")).toBe("zh-CN");
  });
});
