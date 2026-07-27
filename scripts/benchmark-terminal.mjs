#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const MAX_LINES = 1_000_000;
const DEFAULT_LINES = [100_000, 500_000, 1_000_000];
const CHUNK_LINES = 1_000;
const MARKER = "ITERM_XTERM_BENCHMARK_START";
const scriptPath = fileURLToPath(import.meta.url);

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseLineCounts(value) {
  const values = (value ?? DEFAULT_LINES.join(","))
    .split(",")
    .map((item) => Number(item.trim()));
  if (
    values.length === 0 ||
    values.some(
      (item) =>
        !Number.isSafeInteger(item) || item < 1 || item > MAX_LINES,
    )
  ) {
    throw new Error(
      `--lines 必须是 1 到 ${MAX_LINES.toLocaleString()} 之间的逗号分隔整数。`,
    );
  }
  return [...new Set(values)];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function bytesToMiB(value) {
  return round(value / 1024 / 1024);
}

function writeTerminal(terminal, data) {
  return new Promise((resolve) => terminal.write(data, resolve));
}

async function runWorker(lineCount) {
  globalThis.window = {};
  const xtermModule = await import("@xterm/xterm");
  const Terminal = xtermModule.Terminal ?? xtermModule.default?.Terminal;
  if (!Terminal) throw new Error("无法加载 @xterm/xterm 的 Terminal。");

  globalThis.gc?.();
  const rssBefore = process.memoryUsage().rss;
  let peakRss = rssBefore;
  const terminal = new Terminal({
    cols: 120,
    rows: 24,
    scrollback: lineCount + 24,
    convertEol: false,
  });
  const normalLine =
    "iTerm benchmark 中文 UTF-8 \u001b[32mANSI-OK\u001b[0m 0123456789\r\n";
  const fullChunk = normalLine.repeat(CHUNK_LINES);

  const writeStartedAt = performance.now();
  await writeTerminal(terminal, `${MARKER}\r\n`);
  let remaining = lineCount - 1;
  while (remaining > 0) {
    const count = Math.min(CHUNK_LINES, remaining);
    await writeTerminal(
      terminal,
      count === CHUNK_LINES ? fullChunk : normalLine.repeat(count),
    );
    remaining -= count;
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
  const writeMs = performance.now() - writeStartedAt;

  const searchStartedAt = performance.now();
  let markerLine = -1;
  const buffer = terminal.buffer.active;
  for (let index = buffer.length - 1; index >= 0; index -= 1) {
    if (buffer.getLine(index)?.translateToString(true).includes(MARKER)) {
      markerLine = index;
      break;
    }
  }
  const searchMs = performance.now() - searchStartedAt;
  const rssAfter = process.memoryUsage().rss;
  peakRss = Math.max(peakRss, rssAfter);
  const result = {
    lines: lineCount,
    retainedBufferLines: buffer.length,
    writeMs: round(writeMs),
    linesPerSecond: Math.round(lineCount / (writeMs / 1_000)),
    fullBufferSearchMs: round(searchMs),
    markerFound: markerLine >= 0,
    rssBeforeMiB: bytesToMiB(rssBefore),
    rssAfterMiB: bytesToMiB(rssAfter),
    peakRssMiB: bytesToMiB(peakRss),
    rssDeltaMiB: bytesToMiB(peakRss - rssBefore),
  };
  terminal.dispose();
  return result;
}

function runIsolated(lineCount) {
  const child = spawnSync(
    process.execPath,
    ["--expose-gc", scriptPath, "--worker", String(lineCount)],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );
  if (child.status !== 0) {
    throw new Error(
      `终端性能子进程失败（${lineCount.toLocaleString()} 行）：\n${
        child.stderr || child.stdout
      }`,
    );
  }
  return JSON.parse(child.stdout);
}

function assertResults(results) {
  const failures = [];
  for (const result of results) {
    if (!result.markerFound) {
      failures.push(`${result.lines.toLocaleString()} 行：未找到首行标记`);
    }
    if (result.retainedBufferLines < result.lines) {
      failures.push(
        `${result.lines.toLocaleString()} 行：回滚仅保留 ${result.retainedBufferLines.toLocaleString()} 行`,
      );
    }
    if (result.writeMs > 60_000) {
      failures.push(`${result.lines.toLocaleString()} 行：解析超过 60 秒`);
    }
    if (result.fullBufferSearchMs > 30_000) {
      failures.push(`${result.lines.toLocaleString()} 行：搜索超过 30 秒`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`终端性能冒烟检查失败：\n- ${failures.join("\n- ")}`);
  }
}

const workerValue = readOption("--worker");
if (workerValue !== undefined) {
  const lineCount = parseLineCounts(workerValue)[0];
  process.stdout.write(JSON.stringify(await runWorker(lineCount)));
} else {
  const lineCounts = parseLineCounts(readOption("--lines"));
  const results = lineCounts.map(runIsolated);
  if (process.argv.includes("--assert")) assertResults(results);

  const require = createRequire(import.meta.url);
  const xtermVersion = require("@xterm/xterm/package.json").version;
  const report = {
    generatedAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    xterm: xtermVersion,
    renderer: "none",
    results,
  };
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(
      `xterm.js ${xtermVersion} 无渲染性能基线（${report.platform}, ${report.node}）`,
    );
    console.table(
      results.map((result) => ({
        行数: result.lines.toLocaleString(),
        写入毫秒: result.writeMs,
        "行/秒": result.linesPerSecond.toLocaleString(),
        搜索毫秒: result.fullBufferSearchMs,
        "RSS 增量 MiB": result.rssDeltaMiB,
        首行保留: result.markerFound ? "是" : "否",
      })),
    );
  }
}
