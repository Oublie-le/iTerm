import { z } from "zod";
import type { SenderPreset } from "./types";

export const SENDER_PRESET_EXPORT_SCHEMA = "iterm.sender-presets";

const senderPresetSchema: z.ZodType<SenderPreset> = z.object({
  id: z.string().min(1).max(500),
  name: z.string().min(1).max(500),
  mode: z.enum(["text", "hex"]),
  payload: z.string().max(5_000_000),
  lineEnding: z.enum(["none", "lf", "cr", "crlf"]),
  repeat: z.boolean(),
  intervalMs: z.number().int().min(10).max(86_400_000),
});

const senderPresetExportSchema = z.object({
  schema: z.literal(SENDER_PRESET_EXPORT_SCHEMA),
  version: z.literal(1),
  exportedAt: z.string(),
  presets: z.array(senderPresetSchema).min(1).max(1_000),
});

export interface ImportedPresetMerge {
  presets: SenderPreset[];
  importedCount: number;
  remappedCount: number;
  firstImportedId: string;
}

export function serializeSenderPresets(
  presets: SenderPreset[],
  exportedAt = new Date().toISOString(),
): string {
  if (presets.length === 0) {
    throw new Error("没有可导出的命令模板。");
  }
  return `${JSON.stringify(
    {
      schema: SENDER_PRESET_EXPORT_SCHEMA,
      version: 1,
      exportedAt,
      presets,
    },
    null,
    2,
  )}\n`;
}

export function parseSenderPresets(contents: string): SenderPreset[] {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error("文件不是有效的 JSON。");
  }
  const result = senderPresetExportSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const location = issue.path.length > 0 ? issue.path.join(".") : "根对象";
    throw new Error(`命令模板格式无效：${location} ${issue.message}`);
  }
  return result.data.presets;
}

export function mergeImportedSenderPresets(
  existing: SenderPreset[],
  imported: SenderPreset[],
  createId: () => string = () => crypto.randomUUID(),
): ImportedPresetMerge {
  const ids = new Set(existing.map((preset) => preset.id));
  let remappedCount = 0;
  const appended = imported.map((preset) => {
    let id = preset.id;
    while (ids.has(id)) {
      id = createId();
      remappedCount += 1;
    }
    ids.add(id);
    return { ...preset, id };
  });
  return {
    presets: [...existing, ...appended],
    importedCount: appended.length,
    remappedCount,
    firstImportedId: appended[0].id,
  };
}
