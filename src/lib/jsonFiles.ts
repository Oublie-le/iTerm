import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { isTauriRuntime } from "./serial";

const MAX_JSON_FILE_BYTES = 5 * 1024 * 1024;

export interface TextDocument {
  name: string;
  contents: string;
}

function assertDocumentSize(contents: string): void {
  const size = new TextEncoder().encode(contents).byteLength;
  if (size > MAX_JSON_FILE_BYTES) {
    throw new Error("JSON 文件不能超过 5 MiB。");
  }
}

async function openBrowserJsonFile(): Promise<TextDocument | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    document.body.append(input);

    let settled = false;
    const finish = (document: TextDocument | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(document);
    };

    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        if (!file) {
          finish(null);
          return;
        }
        if (file.size > MAX_JSON_FILE_BYTES) {
          input.remove();
          reject(new Error("JSON 文件不能超过 5 MiB。"));
          return;
        }
        void file
          .text()
          .then((contents) => finish({ name: file.name, contents }))
          .catch((error) => {
            input.remove();
            reject(error);
          });
      },
      { once: true },
    );
    window.addEventListener(
      "focus",
      () => window.setTimeout(() => finish(null), 300),
      { once: true },
    );
    input.click();
  });
}

export async function openJsonDocument(): Promise<TextDocument | null> {
  if (!isTauriRuntime()) return openBrowserJsonFile();

  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "iTerm JSON", extensions: ["json"] }],
  });
  if (!path) return null;
  const contents = await readTextFile(path);
  assertDocumentSize(contents);
  return {
    name: path.split(/[\\/]/).at(-1) || path,
    contents,
  };
}

export async function saveJsonDocument(
  suggestedName: string,
  contents: string,
): Promise<string | null> {
  assertDocumentSize(contents);
  if (isTauriRuntime()) {
    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: "iTerm JSON", extensions: ["json"] }],
    });
    if (!path) return null;
    await writeTextFile(path, contents);
    return path;
  }

  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return suggestedName;
}
