/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";
import { browserIntlLocale, browserText } from "./browserI18n";

describe("Browser i18n", () => {
  it("translates Browser copy in all supported languages", () => {
    expect(browserText("Favorites", "fr")).toBe("Favoris");
    expect(browserText("Favorites", "de")).toBe("Favoriten");
    expect(browserText("Favorites", "zh")).toBe("收藏");
  });

  it("interpolates Browser values", () => {
    expect(browserText("{count} results", "fr", { count: 3 })).toBe("3 results");
  });

  it("falls back to English for missing Browser copy", () => {
    expect(browserText("Unknown Browser copy", "fr")).toBe("Unknown Browser copy");
    expect(browserText("Unknown Browser copy", "de")).toBe("Unknown Browser copy");
    expect(browserText("Unknown Browser copy", "zh")).toBe("Unknown Browser copy");
  });

  it("maps Browser formatting to the selected locale", () => {
    expect(browserIntlLocale("en")).toBe("en-US");
    expect(browserIntlLocale("fr")).toBe("fr-FR");
    expect(browserIntlLocale("de")).toBe("de-DE");
    expect(browserIntlLocale("zh")).toBe("zh-CN");
  });
});
