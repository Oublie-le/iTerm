import type { AppLocale } from "./i18n";

const HAN_TEXT = /[\u3400-\u9fff]/u;

const exactEnglishMessages = new Map<string, string>([
  ["JSON 文件不能超过 5 MiB。", "JSON files cannot exceed 5 MiB."],
  ["没有可导出的会话配置。", "There are no session profiles to export."],
  ["没有可导出的命令模板。", "There are no command templates to export."],
  ["文件不是有效的 JSON。", "The file is not valid JSON."],
  ["未选择接收目录。", "No receive directory was selected."],
  ["未选择接收文件。", "No receive file was selected."],
  ["YModem 输出文件名不安全。", "The YModem output filename is unsafe."],
  ["请选择至少一个 YModem 文件。", "Select at least one YModem file."],
  ["请选择至少一个 ZModem 文件。", "Select at least one ZModem file."],
  ["无法读取文件。", "Failed to read the file."],
  ["文件分块大小必须是正整数。", "The file chunk size must be a positive integer."],
  ["文件发送已取消。", "File sending was cancelled."],
  ["文件传输接收通道已关闭。", "The file-transfer receive channel is closed."],
  ["等待文件传输响应超时。", "Timed out waiting for a file-transfer response."],
  ["XModem 接收端取消了传输。", "The XModem receiver cancelled the transfer."],
  ["XModem 发送端取消了传输。", "The XModem sender cancelled the transfer."],
  ["XModem 结束握手失败。", "The XModem completion handshake failed."],
  ["XModem 数据块不能超过 128 字节。", "XModem blocks cannot exceed 128 bytes."],
  ["等待 XModem 接收端响应超时。", "Timed out waiting for the XModem receiver."],
  ["等待 XModem 发送端响应超时。", "Timed out waiting for the XModem sender."],
  ["XModem 文件发送已取消。", "XModem file sending was cancelled."],
  ["XModem 文件接收已取消。", "XModem file reception was cancelled."],
  ["XModem 文件大小超出 512 MiB 限制。", "The XModem file exceeds the 512 MiB limit."],
  ["XModem 数据块连续校验失败次数已用尽。", "XModem block validation retries were exhausted."],
  ["YModem 接收端取消了传输。", "The YModem receiver cancelled the transfer."],
  ["YModem 发送端取消了传输。", "The YModem sender cancelled the transfer."],
  ["YModem 文件结束握手失败。", "The YModem file completion handshake failed."],
  ["YModem 文件发送已取消。", "YModem file sending was cancelled."],
  ["YModem 文件接收已取消。", "YModem file reception was cancelled."],
  ["等待 YModem 接收端响应超时。", "Timed out waiting for the YModem receiver."],
  ["等待 YModem 发送端响应超时。", "Timed out waiting for the YModem sender."],
  ["YModem 元数据缺少文件名结束符。", "YModem metadata has no filename terminator."],
  ["YModem 元数据块重试次数已用尽。", "YModem metadata block retries were exhausted."],
  ["YModem 文件名无效。", "The YModem filename is invalid."],
  ["YModem 文件名不能为空。", "The YModem filename cannot be empty."],
  ["YModem 批次总大小超出 512 MiB 限制。", "The YModem batch exceeds the 512 MiB limit."],
  ["ZModem 协议解析失败。", "Failed to parse the ZModem protocol."],
  ["ZModem 会话已经在等待或运行。", "A ZModem session is already waiting or running."],
  ["等待远端 rz 启动 ZModem 接收超时。", "Timed out waiting for remote rz to receive via ZModem."],
  ["等待远端 sz 启动 ZModem 发送超时。", "Timed out waiting for remote sz to send via ZModem."],
  ["ZModem 写入失败。", "Failed to write ZModem data."],
  ["无法确认 ZModem 会话。", "Failed to confirm the ZModem session."],
  ["ZModem 文件接收失败。", "Failed to receive a ZModem file."],
  ["ZModem 文件传输已取消。", "The ZModem file transfer was cancelled."],
  ["ZModem 批次总大小超出 512 MiB 限制。", "The ZModem batch exceeds the 512 MiB limit."],
  ["ZModem 文件大小超出 512 MiB 限制。", "The ZModem file exceeds the 512 MiB limit."],
  ["ZModem 文件数据超出 512 MiB 限制。", "ZModem file data exceeds the 512 MiB limit."],
  ["ZModem 批次总数据超出 512 MiB 限制。", "ZModem batch data exceeds the 512 MiB limit."],
  [
    "检测到远端正在发送文件；当前操作需要远端运行 rz。",
    "The remote side is sending; this operation requires remote rz.",
  ],
  [
    "检测到远端正在接收文件；当前操作需要远端运行 sz。",
    "The remote side is receiving; this operation requires remote sz.",
  ],
  ["串口路径不能为空。", "The serial port path cannot be empty."],
  ["该会话已打开，请先断开后再重连。", "This session is already open. Disconnect it before reconnecting."],
  ["当前会话没有活动日志。", "The current session has no active log."],
  ["串口会话不存在或已经关闭。", "The serial session does not exist or is already closed."],
  ["串口读取线程已经退出，请重新连接。", "The serial reader has exited. Reconnect the session."],
  ["SSH/ADB 会话不存在或已经关闭。", "The SSH/ADB session does not exist or is already closed."],
  ["SSH/ADB 会话进程已经退出，请重新连接。", "The SSH/ADB process has exited. Reconnect the session."],
  ["该 SSH/ADB 会话已经打开，请先断开。", "This SSH/ADB session is already open. Disconnect it first."],
  ["找不到 adb 命令，请安装 Android SDK Platform Tools。", "adb was not found. Install Android SDK Platform Tools."],
  ["使用私钥认证时必须填写私钥路径。", "A private key path is required for private-key authentication."],
  ["日志文件大小限制过大。", "The log file size limit is too large."],
  ["日志文件已经关闭。", "The log file is already closed."],
  ["接收数据过大，无法写入文本日志。", "Received data is too large for the text log."],
  ["文本日志解码缓冲区不足。", "The text log decode buffer is too small."],
  ["只能打开 iTerm 日志目录中的文件。", "Only files inside the iTerm log directory can be opened."],
]);

const englishPatterns: Array<[
  RegExp,
  (...groups: string[]) => string,
]> = [
  [/^Hex 数据缺少半个字节（共 (\d+) 个字符）$/u, (count) =>
    `Hex data has an incomplete byte (${count} characters total).`],
  [/^Hex 数据第 (\d+) 个字符无效$/u, (index) =>
    `Character ${index} in the Hex data is invalid.`],
  [/^(.+)仅写入 (\d+)\/(\d+) 字节(?:，文件发送已停止。|。)$/u, (source, written, total) =>
    `${protocolName(source)} wrote only ${written}/${total} bytes.`],
  [/^(XModem|YModem) 第? ?(\d+)?块?重试 (\d+) 次后仍未收到 ACK。$/u, (protocol, block, retries) =>
    `${protocol}${block ? ` block ${block}` : " block"} did not receive ACK after ${retries} retries.`],
  [/^(YModem|ZModem) 文件“(.+)”大小不匹配：收到 (\d+)\/(\d+) 字节。$/u, (protocol, name, received, expected) =>
    `${protocol} file “${name}” size mismatch: received ${received}/${expected} bytes.`],
  [/^YModem 文件“(.+)”缺少有效大小。$/u, (name) =>
    `YModem file “${name}” has no valid size.`],
  [/^YModem 文件名“(.+)”过长。$/u, (name) =>
    `YModem filename “${name}” is too long.`],
  [/^(YModem|ZModem) 文件“(.+)”(?:大小超出|超过) 512 MiB(?: 限制)?。$/u, (protocol, name) =>
    `${protocol} file “${name}” exceeds 512 MiB.`],
  [/^正在打开 (.+)…$/u, (target) => `Opening ${target}…`],
  [/^正在连接 SSH (.+)…$/u, (target) => `Connecting to SSH ${target}…`],
  [/^正在打开 (.+) Shell…$/u, (target) => `Opening ${target} shell…`],
  [/^(.+) 已连接$/u, (target) => `${target} connected`],
  [/^(.+) 已启动$/u, (target) => `${target} started`],
  [/^(.+) 已断开。$/u, (target) => `${target} disconnected.`],
  [/^(.+) 已结束。$/u, (target) => `${target} exited.`],
  [/^(.+) 异常退出（(.+)）。$/u, (target, status) =>
    `${target} exited unexpectedly (${status}).`],
  [/^串口 (.+) 已被另一个会话占用。$/u, (port) =>
    `Serial port ${port} is in use by another session.`],
  [/^无法打开串口 (.+)：(.+)$/u, (port, reason) =>
    `Failed to open serial port ${port}: ${reason}`],
  [/^读取串口 (.+) 失败：(.+)$/u, (port, reason) =>
    `Failed to read serial port ${port}: ${reason}`],
  [/^不支持字符编码：(.+)$/u, (encoding) =>
    `Unsupported character encoding: ${encoding}`],
  [/^文本包含无法由 (.+) 表示的字符。$/u, (encoding) =>
    `The text contains characters that cannot be represented by ${encoding}.`],
  [/^(.+)超时。$/u, (action) => `${actionName(action)} timed out.`],
  [/^无法执行 adb devices：(.+)$/u, (reason) =>
    `Failed to run adb devices: ${reason}`],
  [/^adb devices 执行失败：(.+)$/u, (reason) =>
    `adb devices failed: ${reason}`],
  [/^无法使用系统打开 (.+)：(.+)$/u, (path, reason) =>
    `Failed to open ${path} with the system handler: ${reason}`],
];

function protocolName(value: string): string {
  if (value === "串口") return "Serial";
  return value.trim();
}

function actionName(value: string): string {
  const actions: Record<string, string> = {
    "设置信号": "Setting the signal",
    "发送 Break": "Sending Break",
    "清空串口缓冲": "Clearing serial buffers",
    "开始日志": "Starting logging",
    "暂停日志": "Pausing logging",
    "继续日志": "Resuming logging",
    "停止日志": "Stopping logging",
    "写入串口": "Writing to the serial port",
    "写入 SSH/ADB 会话": "Writing to the SSH/ADB session",
    "调整 SSH/ADB 终端尺寸": "Resizing the SSH/ADB terminal",
    "开始 SSH/ADB 日志": "Starting SSH/ADB logging",
    "暂停 SSH/ADB 日志": "Pausing SSH/ADB logging",
    "继续 SSH/ADB 日志": "Resuming SSH/ADB logging",
    "停止 SSH/ADB 日志": "Stopping SSH/ADB logging",
  };
  return actions[value] ?? "The operation";
}

export function localizedErrorMessage(
  error: unknown,
  locale: AppLocale,
  fallback = locale === "en-US"
    ? "The operation failed. See local diagnostics for technical details."
    : "操作失败，请查看本地诊断了解技术详情。",
): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error === null || error === undefined
          ? ""
          : String(error);
  if (!message) return fallback;
  if (locale !== "en-US") return message;

  const exact = exactEnglishMessages.get(message);
  if (exact) return exact;
  for (const [pattern, format] of englishPatterns) {
    const match = message.match(pattern);
    if (match) return format(...match.slice(1));
  }
  return HAN_TEXT.test(message) ? fallback : message;
}
