import { describe, expect, it } from "vitest";
import { resolveShortcut, type ShortcutInput } from "./shortcuts";

const shortcut = (
  key: string,
  patch: Partial<ShortcutInput> = {},
): ShortcutInput => ({
  key,
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false,
  ...patch,
});

describe("keyboard shortcuts", () => {
  it("maps core workspace actions for Ctrl and Command", () => {
    expect(resolveShortcut(shortcut("n"), false)).toBe("newSession");
    expect(
      resolveShortcut(shortcut("w", { ctrlKey: false, metaKey: true }), false),
    ).toBe("closeSession");
    expect(resolveShortcut(shortcut("Tab"), false)).toBe("nextSession");
    expect(resolveShortcut(shortcut("Tab", { shiftKey: true }), false)).toBe(
      "previousSession",
    );
    expect(resolveShortcut(shortcut("Enter"), false)).toBe("toggleConnection");
  });

  it("does not intercept shortcuts while editing form fields", () => {
    expect(resolveShortcut(shortcut("n"), true)).toBeUndefined();
    expect(resolveShortcut(shortcut("Escape", { ctrlKey: false }), true)).toBe(
      "escape",
    );
  });

  it("ignores repeats, Alt combinations and unknown shortcuts", () => {
    expect(resolveShortcut(shortcut("n", { repeat: true }), false)).toBeUndefined();
    expect(resolveShortcut(shortcut("n", { altKey: true }), false)).toBeUndefined();
    expect(resolveShortcut(shortcut("q"), false)).toBeUndefined();
  });
});
