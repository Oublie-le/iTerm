import type { TriggerRule } from "./types";

const MAX_MATCH_BUFFER = 8_192;

export interface TriggerMatch {
  rule: TriggerRule;
  matchedText: string;
}

interface TriggerRuntime {
  count: number;
  lastTriggeredAt: number;
}

export function createTriggerRule(index = 1): TriggerRule {
  return {
    id: crypto.randomUUID(),
    name: `触发器 ${index}`,
    enabled: true,
    matcher: "text",
    pattern: "",
    caseSensitive: false,
    action: "notification",
    payload: "检测到匹配内容",
    cooldownMs: 1_000,
    maxTriggers: 0,
  };
}

export function validateTriggerRule(rule: TriggerRule): string | undefined {
  if (!rule.name.trim()) return "触发器名称不能为空。";
  if (!rule.pattern) return `“${rule.name}”的匹配内容不能为空。`;
  if (!Number.isInteger(rule.cooldownMs) || rule.cooldownMs < 0) {
    return `“${rule.name}”的冷却时间必须是大于等于 0 的整数。`;
  }
  if (!Number.isInteger(rule.maxTriggers) || rule.maxTriggers < 0) {
    return `“${rule.name}”的最大次数必须是大于等于 0 的整数。`;
  }
  if (
    (rule.action === "sendText" || rule.action === "notification") &&
    !rule.payload
  ) {
    return `“${rule.name}”的动作内容不能为空。`;
  }
  if (rule.matcher === "regex") {
    try {
      const expression = new RegExp(rule.pattern);
      if (expression.test("")) return `“${rule.name}”的正则不能匹配空字符串。`;
    } catch (error) {
      return `“${rule.name}”的正则无效：${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }
  return undefined;
}

export class SessionTriggerEvaluator {
  private readonly decoder: TextDecoder;
  private buffer = "";
  private readonly runtime = new Map<string, TriggerRuntime>();

  constructor(encoding: string) {
    this.decoder = new TextDecoder(encoding, { fatal: false });
  }

  feed(
    bytes: Uint8Array,
    rules: TriggerRule[],
    now = Date.now(),
  ): TriggerMatch[] {
    const decoded = this.decoder.decode(bytes, { stream: true });
    if (!decoded) return [];

    const previousLength = this.buffer.length;
    const combined = `${this.buffer}${decoded}`;
    const matches: TriggerMatch[] = [];
    for (const rule of rules) {
      if (!rule.enabled || validateTriggerRule(rule)) continue;
      for (const matchedText of findNewMatches(rule, combined, previousLength)) {
        const runtime = this.runtime.get(rule.id) ?? {
          count: 0,
          lastTriggeredAt: Number.NEGATIVE_INFINITY,
        };
        if (rule.maxTriggers > 0 && runtime.count >= rule.maxTriggers) break;
        if (now - runtime.lastTriggeredAt < rule.cooldownMs) break;
        runtime.count += 1;
        runtime.lastTriggeredAt = now;
        this.runtime.set(rule.id, runtime);
        matches.push({ rule, matchedText });
      }
    }

    this.buffer = combined.slice(-MAX_MATCH_BUFFER);
    return matches;
  }
}

function findNewMatches(
  rule: TriggerRule,
  value: string,
  previousLength: number,
): string[] {
  if (rule.matcher === "text") {
    const source = rule.caseSensitive ? value : value.toLocaleLowerCase();
    const pattern = rule.caseSensitive
      ? rule.pattern
      : rule.pattern.toLocaleLowerCase();
    const matches: string[] = [];
    let offset = 0;
    while (offset <= source.length - pattern.length) {
      const index = source.indexOf(pattern, offset);
      if (index < 0) break;
      if (index + pattern.length > previousLength) {
        matches.push(value.slice(index, index + pattern.length));
      }
      offset = index + Math.max(1, pattern.length);
    }
    return matches;
  }

  const flags = `${rule.caseSensitive ? "" : "i"}gu`;
  const expression = new RegExp(rule.pattern, flags);
  const matches: string[] = [];
  for (const match of value.matchAll(expression)) {
    const index = match.index ?? 0;
    if (index + match[0].length > previousLength) matches.push(match[0]);
  }
  return matches;
}
