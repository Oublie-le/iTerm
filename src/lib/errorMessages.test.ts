import { describe, expect, it } from "vitest";
import { localizedErrorMessage } from "./errorMessages";

describe("localizedErrorMessage", () => {
  it("preserves Chinese and already-English messages", () => {
    expect(
      localizedErrorMessage(new Error("文件发送已取消。"), "zh-CN"),
    ).toBe("文件发送已取消。");
    expect(localizedErrorMessage("Permission denied", "en-US")).toBe(
      "Permission denied",
    );
  });

  it("translates exact and parameterized protocol errors", () => {
    expect(localizedErrorMessage("文件发送已取消。", "en-US")).toBe(
      "File sending was cancelled.",
    );
    expect(
      localizedErrorMessage(
        "Hex 数据缺少半个字节（共 3 个字符）",
        "en-US",
      ),
    ).toBe("Hex data has an incomplete byte (3 characters total).");
    expect(
      localizedErrorMessage(
        "串口仅写入 12/20 字节，文件发送已停止。",
        "en-US",
      ),
    ).toBe("Serial wrote only 12/20 bytes.");
  });

  it("hides untranslated backend text behind a safe English fallback", () => {
    expect(
      localizedErrorMessage("未覆盖的后端错误", "en-US"),
    ).toBe(
      "The operation failed. See local diagnostics for technical details.",
    );
  });
});
