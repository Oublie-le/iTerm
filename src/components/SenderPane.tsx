import {
  CirclePlus,
  Eraser,
  FileUp,
  Play,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadSenderPresets, saveSenderPresets } from "../lib/senders";
import { createSenderPreset, type SenderPreset } from "../lib/types";

interface SenderPaneProps {
  profileId: string;
  connected: boolean;
  onClose: () => void;
  onSend: (preset: SenderPreset) => Promise<number>;
  onSendFile: (
    file: File,
    onProgress: (sentBytes: number, totalBytes: number) => void,
    signal: AbortSignal,
  ) => Promise<number>;
}

export function SenderPane({
  profileId,
  connected,
  onClose,
  onSend,
  onSendFile,
}: SenderPaneProps) {
  const [presets, setPresets] = useState<SenderPreset[]>(() =>
    loadSenderPresets(profileId),
  );
  const [activeId, setActiveId] = useState(presets[0].id);
  const [running, setRunning] = useState(false);
  const [sentBytes, setSentBytes] = useState(0);
  const [lastError, setLastError] = useState("");
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileAbortRef = useRef<AbortController | null>(null);
  const [fileTransfer, setFileTransfer] = useState<{
    name: string;
    sentBytes: number;
    totalBytes: number;
  } | null>(null);

  const active =
    presets.find((preset) => preset.id === activeId) ?? presets[0];

  const updateActive = (patch: Partial<SenderPreset>) => {
    setPresets((current) =>
      current.map((preset) =>
        preset.id === active.id ? { ...preset, ...patch } : preset,
      ),
    );
  };

  const stop = () => {
    cancelledRef.current = true;
    setRunning(false);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    fileAbortRef.current?.abort();
    fileAbortRef.current = null;
  };

  useEffect(() => {
    if (!connected) stop();
    return stop;
  }, [connected]);

  useEffect(() => {
    saveSenderPresets(profileId, presets);
  }, [presets, profileId]);

  const sendOnce = async () => {
    setLastError("");
    try {
      const count = await onSend(active);
      setSentBytes((value) => value + count);
      return true;
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const start = async () => {
    if (!connected || running || !active.payload.trim()) return;
    if (!active.repeat) {
      await sendOnce();
      return;
    }

    cancelledRef.current = false;
    setRunning(true);
    const tick = async () => {
      if (cancelledRef.current) return;
      const succeeded = await sendOnce();
      if (!succeeded || cancelledRef.current) {
        stop();
        return;
      }
      timerRef.current = window.setTimeout(
        tick,
        Math.max(10, active.intervalMs),
      );
    };
    await tick();
  };

  const addPreset = () => {
    const preset = createSenderPreset(presets.length + 1);
    setPresets((current) => [...current, preset]);
    setActiveId(preset.id);
  };

  const removeActive = () => {
    if (presets.length === 1) return;
    const index = presets.findIndex((preset) => preset.id === active.id);
    const next = presets.filter((preset) => preset.id !== active.id);
    setPresets(next);
    setActiveId(next[Math.max(0, index - 1)].id);
  };

  const sendFile = async (file: File) => {
    setLastError("");
    const controller = new AbortController();
    fileAbortRef.current = controller;
    setRunning(true);
    setFileTransfer({
      name: file.name,
      sentBytes: 0,
      totalBytes: file.size,
    });
    try {
      const count = await onSendFile(
        file,
        (sentBytes, totalBytes) =>
          setFileTransfer({ name: file.name, sentBytes, totalBytes }),
        controller.signal,
      );
      setSentBytes((value) => value + count);
    } catch (error) {
      if (!controller.signal.aborted) {
        setLastError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      fileAbortRef.current = null;
      setRunning(false);
    }
  };

  return (
    <section className="sender-pane" aria-label="发送窗格">
      <header className="sender-toolbar">
        <div className="sender-actions">
          <button
            className="toolbar-button primary"
            onClick={start}
            disabled={!connected || running || !active.payload.trim()}
            title="发送"
          >
            <Play size={15} fill="currentColor" />
            发送
          </button>
          <button
            className="toolbar-button danger"
            onClick={stop}
            disabled={!running}
            title="停止"
          >
            <Square size={14} fill="currentColor" />
            停止
          </button>
          <span className="toolbar-separator" />
          <button className="icon-button" onClick={addPreset} title="添加发送器">
            <CirclePlus size={17} />
          </button>
          <button
            className="icon-button"
            onClick={removeActive}
            disabled={presets.length === 1}
            title="删除发送器"
          >
            <Trash2 size={16} />
          </button>
          <button
            className="icon-button"
            onClick={() => updateActive({ payload: "" })}
            disabled={running || !active.payload}
            title="清空当前发送内容"
          >
            <Eraser size={16} />
          </button>
          <button
            className="icon-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!connected || running}
            title="发送原始文件"
          >
            <FileUp size={16} />
          </button>
          <input
            ref={fileInputRef}
            className="hidden-file-input"
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void sendFile(file);
              event.target.value = "";
            }}
          />
        </div>
        <div className="sender-tabs">
          {presets.map((preset) => (
            <button
              key={preset.id}
              className={preset.id === active.id ? "is-active" : ""}
              onClick={() => {
                stop();
                setActiveId(preset.id);
              }}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <button className="icon-button" onClick={onClose} title="关闭发送窗格">
          <X size={17} />
        </button>
      </header>

      <div className="sender-body">
        <textarea
          value={active.payload}
          onChange={(event) => updateActive({ payload: event.target.value })}
          disabled={running}
          placeholder={
            active.mode === "hex"
              ? "输入 Hex，例如：AA 55 01 0D 0A"
              : "输入要发送的文本…"
          }
          spellCheck={false}
          aria-label="发送内容"
        />
        <div className="sender-options">
          <label>
            名称
            <input
              className="sender-name-input"
              value={active.name}
              disabled={running}
              onChange={(event) => updateActive({ name: event.target.value })}
            />
          </label>
          <label>
            模式
            <select
              value={active.mode}
              disabled={running}
              onChange={(event) =>
                updateActive({ mode: event.target.value as "text" | "hex" })
              }
            >
              <option value="text">文本</option>
              <option value="hex">Hex</option>
            </select>
          </label>
          <label>
            行尾
            <select
              value={active.lineEnding}
              disabled={running || active.mode === "hex"}
              onChange={(event) =>
                updateActive({
                  lineEnding: event.target
                    .value as SenderPreset["lineEnding"],
                })
              }
            >
              <option value="none">无</option>
              <option value="lf">LF</option>
              <option value="cr">CR</option>
              <option value="crlf">CRLF</option>
            </select>
          </label>
          <label className="check-option">
            <input
              type="checkbox"
              checked={active.repeat}
              disabled={running}
              onChange={(event) =>
                updateActive({ repeat: event.target.checked })
              }
            />
            重复执行
          </label>
          <label>
            间隔
            <span className="number-with-unit">
              <input
                type="number"
                min={10}
                max={86_400_000}
                value={active.intervalMs}
                disabled={running || !active.repeat}
                onChange={(event) =>
                  updateActive({
                    intervalMs: Math.max(10, Number(event.target.value) || 10),
                  })
                }
              />
              ms
            </span>
          </label>
          <div className="sender-stats">
            已发送 {sentBytes.toLocaleString()} B
            {lastError && <strong>{lastError}</strong>}
          </div>
          {fileTransfer && (
            <div className="file-transfer-progress">
              <span title={fileTransfer.name}>{fileTransfer.name}</span>
              <progress
                value={fileTransfer.sentBytes}
                max={Math.max(1, fileTransfer.totalBytes)}
              />
              <strong>
                {Math.round(
                  (fileTransfer.sentBytes /
                    Math.max(1, fileTransfer.totalBytes)) *
                    100,
                )}
                %
              </strong>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
