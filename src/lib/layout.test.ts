import { describe, expect, it } from "vitest";
import {
  createSplitSessionIds,
  selectSplitSession,
} from "./layout";

describe("split terminal layout", () => {
  it("creates a pair around the active session", () => {
    expect(createSplitSessionIds(["one", "two", "three"], "two")).toEqual([
      "two",
      "one",
    ]);
    expect(createSplitSessionIds(["one"], "one")).toBeNull();
  });

  it("replaces the active pane when another tab is selected", () => {
    expect(selectSplitSession(["one", "two"], "one", "three")).toEqual([
      "three",
      "two",
    ]);
    expect(selectSplitSession(["one", "two"], "two", "three")).toEqual([
      "one",
      "three",
    ]);
    expect(selectSplitSession(["one", "two"], "one", "two")).toEqual([
      "one",
      "two",
    ]);
  });
});
