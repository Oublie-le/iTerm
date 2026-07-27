import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "./serial";
import type { LogMode } from "./types";

export function defaultLogFileName(
  sessionName: string,
  now = new Date(),
): string {
  const safeName = Array.from(
    sessionName
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .trim()
      .replace(/^\.+|\.+$/g, ""),
  )
    .slice(0, 80)
    .join("") || "session";
  const part = (value: number) => value.toString().padStart(2, "0");
  const timestamp = [
    now.getFullYear(),
    part(now.getMonth() + 1),
    part(now.getDate()),
  ].join("-") + `_${part(now.getHours())}-${part(now.getMinutes())}-${part(now.getSeconds())}`;
  return `${safeName}_${timestamp}.log`;
}

export async function selectLogOutputFile(
  sessionName: string,
  mode: LogMode,
  title: string,
): Promise<string | null> {
  const suggestedName = defaultLogFileName(sessionName);
  if (!isTauriRuntime()) return suggestedName;
  return save({
    title,
    defaultPath: suggestedName,
    filters:
      mode === "raw"
        ? [{ name: "Raw log", extensions: ["log", "bin"] }]
        : [{ name: "Text log", extensions: ["log", "txt"] }],
  });
}

export async function openLogDirectory(path?: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("open_log_directory", { path });
  }
}

export async function openLogFile(path: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("open_log_file", { path });
  }
}
