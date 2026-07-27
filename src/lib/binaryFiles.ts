import { join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { isTauriRuntime } from "./serial";
import type { ReceivedYmodemFile } from "./ymodemReceive";

export async function selectBinaryOutputDirectory(
  title = "选择文件接收目录",
): Promise<string | null> {
  if (!isTauriRuntime()) return "";
  return open({
    directory: true,
    multiple: false,
    title,
  });
}

export async function saveReceivedBinaryFiles(
  directory: string,
  files: ReceivedYmodemFile[],
): Promise<void> {
  if (isTauriRuntime()) {
    if (!directory) throw new Error("未选择接收目录。");
    for (const file of files) {
      assertSafeOutputName(file.name);
      await writeFile(await join(directory, file.name), file.bytes);
    }
    return;
  }

  for (const file of files) {
    assertSafeOutputName(file.name);
    const bytes = file.bytes.slice().buffer as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([bytes]));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function assertSafeOutputName(name: string): void {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw new Error("YModem 输出文件名不安全。");
  }
}
