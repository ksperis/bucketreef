/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider, useLanguage } from "./language";
import { setSessionUserCache } from "../utils/workspaces";

function CurrentLanguage() {
  const { language } = useLanguage();
  return <output>{language}</output>;
}

describe("browser language selection", () => {
  beforeEach(() => setSessionUserCache(null));
  afterEach(() => { cleanup(); setSessionUserCache(null); vi.restoreAllMocks(); });

  it.each([
    { languages: ["zh", "en"], expected: "zh" },
    { languages: ["zh-CN", "en"], expected: "zh" },
    { languages: ["zh-SG", "en"], expected: "zh" },
    { languages: ["zh-Hans", "en"], expected: "zh" },
    { languages: ["zh-Hant", "fr"], expected: "fr" },
    { languages: ["zh-TW", "de"], expected: "de" },
    { languages: ["zh-HK", "zh-CN"], expected: "zh" },
    { languages: ["zh-MO"], expected: "en" },
    { languages: ["ja-JP"], expected: "en" },
  ])("resolves $languages to $expected", ({ languages, expected }) => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(languages);
    render(<LanguageProvider><CurrentLanguage /></LanguageProvider>);
    expect(screen.getByRole("status")).toHaveTextContent(expected);
    expect(document.documentElement.lang).toBe(expected === "zh" ? "zh-Hans" : expected);
  });

  it("honors explicitly saved Chinese even with a Traditional Chinese browser", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["zh-TW", "en"]);
    setSessionUserCache({ ui_language: "zh" });
    render(<LanguageProvider><CurrentLanguage /></LanguageProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("zh");
  });
});
