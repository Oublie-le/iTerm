import { describe, expect, it, vi } from "vitest";
import {
  SessionTriggerEvaluator,
  createTriggerRule,
  validateTriggerRule,
} from "./triggers";

describe("session triggers", () => {
  it("matches text across data chunks", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "trigger-1" });
    const rule = {
      ...createTriggerRule(),
      pattern: "READY>",
      cooldownMs: 0,
    };
    const evaluator = new SessionTriggerEvaluator("utf-8");

    expect(evaluator.feed(new TextEncoder().encode("boot REA"), [rule], 1)).toEqual(
      [],
    );
    expect(
      evaluator.feed(new TextEncoder().encode("DY>"), [rule], 2),
    ).toMatchObject([{ rule: { id: "trigger-1" }, matchedText: "READY>" }]);
    vi.unstubAllGlobals();
  });

  it("supports regular expressions, cooldown and maximum counts", () => {
    const rule = {
      ...createTriggerRule(),
      id: "errors",
      matcher: "regex" as const,
      pattern: "error\\s+\\d+",
      cooldownMs: 100,
      maxTriggers: 2,
    };
    const evaluator = new SessionTriggerEvaluator("utf-8");

    expect(
      evaluator.feed(new TextEncoder().encode("ERROR 42"), [rule], 1_000),
    ).toHaveLength(1);
    expect(
      evaluator.feed(new TextEncoder().encode(" error 43"), [rule], 1_050),
    ).toHaveLength(0);
    expect(
      evaluator.feed(new TextEncoder().encode(" error 44"), [rule], 1_101),
    ).toHaveLength(1);
    expect(
      evaluator.feed(new TextEncoder().encode(" error 45"), [rule], 1_500),
    ).toHaveLength(0);
  });

  it("rejects empty-match regular expressions and incomplete actions", () => {
    expect(
      validateTriggerRule({
        ...createTriggerRule(),
        matcher: "regex",
        pattern: ".*",
      }),
    ).toContain("不能匹配空字符串");
    expect(
      validateTriggerRule({
        ...createTriggerRule(),
        pattern: "READY",
        action: "sendText",
        payload: "",
      }),
    ).toContain("动作内容不能为空");
  });
});
