import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./serial";

export async function openLogDirectory(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("open_log_directory");
  }
}

export async function openLogFile(path: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("open_log_file", { path });
  }
}
