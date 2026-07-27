import { describe, expect, it } from "vitest";
import { createTranslator, resolveLocale } from "./i18n";

describe("internationalization", () => {
  it("translates typed keys into Chinese and English", () => {
    expect(createTranslator("zh-CN")("settings.title")).toBe("应用设置");
    expect(createTranslator("en-US")("settings.title")).toBe(
      "Application Settings",
    );
  });

  it("interpolates dynamic values without evaluating them", () => {
    expect(
      createTranslator("en-US")("settings.diagnostics.count", { count: 12 }),
    ).toBe("12 / 500 structured events currently retained");
  });

  it("resolves the explicitly saved locale", () => {
    expect(resolveLocale("zh-CN", "en-US")).toBe("zh-CN");
    expect(resolveLocale("en-US", "zh-CN")).toBe("en-US");
  });
});
