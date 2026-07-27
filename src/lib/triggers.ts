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

export interface TriggerValidationMessages {
  nameRequired: string;
  patternRequired: (name: string) => string;
  cooldownInvalid: (name: string) => string;
  maxTriggersInvalid: (name: string) => string;
  payloadRequired: (name: string) => string;
  regexMatchesEmpty: (name: string) => string;
  regexInvalid: (name: string, reason: string) => string;
}

const defaultValidationMessages: TriggerValidationMessages = {
  nameRequired: "触发器名称不能为空。",
  patternRequired: (name) => `“${name}”的匹配内容不能为空。`,
  cooldownInvalid: (name) =>
    `“${name}”的冷却时间必须是大于等于 0 的整数。`,
  maxTriggersInvalid: (name) =>
    `“${name}”的最大次数必须是大于等于 0 的整数。`,
  payloadRequired: (name) => `“${name}”的动作内容不能为空。`,
  regexMatchesEmpty: (name) => `“${name}”的正则不能匹配空字符串。`,
  regexInvalid: (name, reason) => `“${name}”的正则无效：${reason}`,
};

export function createTriggerRule(
  index = 1,
  namePrefix = "触发器",
  defaultPayload = "检测到匹配内容",
): TriggerRule {
  return {
    id: crypto.randomUUID(),
    name: `${namePrefix} ${index}`,
    enabled: true,
    matcher: "text",
    pattern: "",
    caseSensitive: false,
    action: "notification",
    payload: defaultPayload,
    cooldownMs: 1_000,
    maxTriggers: 0,
  };
}

export function validateTriggerRule(
  rule: TriggerRule,
  messages: TriggerValidationMessages = defaultValidationMessages,
): string | undefined {
  if (!rule.name.trim()) return messages.nameRequired;
  if (!rule.pattern) return messages.patternRequired(rule.name);
  if (!Number.isInteger(rule.cooldownMs) || rule.cooldownMs < 0) {
    return messages.cooldownInvalid(rule.name);
  }
  if (!Number.isInteger(rule.maxTriggers) || rule.maxTriggers < 0) {
    return messages.maxTriggersInvalid(rule.name);
  }
  if (
    (rule.action === "sendText" || rule.action === "notification") &&
    !rule.payload
  ) {
    return messages.payloadRequired(rule.name);
  }
  if (rule.matcher === "regex") {
    try {
      const expression = new RegExp(rule.pattern);
      if (expression.test("")) return messages.regexMatchesEmpty(rule.name);
    } catch (error) {
      return messages.regexInvalid(
        rule.name,
        error instanceof Error ? error.message : String(error),
      );
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
