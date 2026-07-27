import { join } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
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

export async function selectBinaryOutputFile(
  title = "选择文件保存位置",
  suggestedName = "xmodem-received.bin",
): Promise<string | null> {
  if (!isTauriRuntime()) return suggestedName;
  return save({
    title,
    defaultPath: suggestedName,
    filters: [{ name: "Binary", extensions: ["bin", "img", "dat", "hex"] }],
  });
}

export async function saveReceivedBinaryFile(
  path: string,
  suggestedName: string,
  bytes: Uint8Array,
): Promise<void> {
  if (isTauriRuntime()) {
    if (!path) throw new Error("未选择接收文件。");
    await writeFile(path, bytes);
    return;
  }
  downloadBinaryFile(suggestedName, bytes);
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
    downloadBinaryFile(file.name, file.bytes);
  }
}

function downloadBinaryFile(name: string, bytes: Uint8Array): void {
  assertSafeOutputName(name);
  const buffer = bytes.slice().buffer as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buffer]));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
