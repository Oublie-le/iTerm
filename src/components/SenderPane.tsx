import {
  CirclePlus,
  Download,
  Eraser,
  FileDown,
  FileUp,
  FolderDown,
  Play,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadSenderPresets, saveSenderPresets } from "../lib/senders";
import { openJsonDocument, saveJsonDocument } from "../lib/jsonFiles";
import {
  mergeImportedSenderPresets,
  parseSenderPresets,
  serializeSenderPresets,
} from "../lib/senderTransfer";
import type { YmodemReceiveProgress } from "../lib/ymodemReceive";
import {
  createSenderPreset,
  type FileTransferProtocol,
  type SenderPreset,
} from "../lib/types";
import { useI18n } from "../lib/i18n";

interface SenderPaneProps {
  profileId: string;
  connected: boolean;
  onClose: () => void;
  onSend: (preset: SenderPreset) => Promise<number>;
  onSendFiles: (
    files: File[],
    protocol: FileTransferProtocol,
    onProgress: (sentBytes: number, totalBytes: number) => void,
    signal: AbortSignal,
  ) => Promise<number>;
  onReceiveYmodem: (
    onProgress: (progress: YmodemReceiveProgress) => void,
    signal: AbortSignal,
  ) => Promise<{ fileCount: number; totalBytes: number } | null>;
  onReceiveZmodem: (
    onProgress: (progress: YmodemReceiveProgress) => void,
    signal: AbortSignal,
  ) => Promise<{ fileCount: number; totalBytes: number } | null>;
}

export function SenderPane({
  profileId,
  connected,
  onClose,
  onSend,
  onSendFiles,
  onReceiveYmodem,
  onReceiveZmodem,
}: SenderPaneProps) {
  const { locale, t } = useI18n();
  const [presets, setPresets] = useState<SenderPreset[]>(() =>
    loadSenderPresets(profileId, localStorage, t("sender.defaultName")),
  );
  const [activeId, setActiveId] = useState(presets[0].id);
  const [running, setRunning] = useState(false);
  const [sentBytes, setSentBytes] = useState(0);
  const [lastError, setLastError] = useState("");
  const [templateNotice, setTemplateNotice] = useState("");
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileAbortRef = useRef<AbortController | null>(null);
  const [fileTransfer, setFileTransfer] = useState<{
    name: string;
    sentBytes: number;
    totalBytes: number;
  } | null>(null);
  const [fileProtocol, setFileProtocol] =
    useState<FileTransferProtocol>("raw");

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
    const preset = createSenderPreset(
      presets.length + 1,
      t("sender.defaultName"),
    );
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

  const exportPresets = async () => {
    setLastError("");
    setTemplateNotice("");
    try {
      const date = new Date().toISOString().slice(0, 10);
      const path = await saveJsonDocument(
        `iTerm-commands-${date}.json`,
        serializeSenderPresets(presets),
      );
      if (path) {
        setTemplateNotice(
          t("sender.exported", { count: presets.length }),
        );
      }
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
    }
  };

  const importPresets = async () => {
    setLastError("");
    setTemplateNotice("");
    try {
      const document = await openJsonDocument();
      if (!document) return;
      const imported = parseSenderPresets(document.contents);
      const merged = mergeImportedSenderPresets(presets, imported);
      setPresets(merged.presets);
      setActiveId(merged.firstImportedId);
      setTemplateNotice(
        merged.remappedCount > 0
          ? t("sender.importedRemapped", {
              count: merged.importedCount,
              remapped: merged.remappedCount,
            })
          : t("sender.imported", { count: merged.importedCount }),
      );
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
    }
  };

  const sendFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setLastError("");
    const controller = new AbortController();
    fileAbortRef.current = controller;
    setRunning(true);
    const transferName =
      files.length === 1
        ? files[0].name
        : t("sender.files", { count: files.length });
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    setFileTransfer({
      name: transferName,
      sentBytes: 0,
      totalBytes,
    });
    try {
      const count = await onSendFiles(
        files,
        fileProtocol,
        (sentBytes, totalBytes) =>
          setFileTransfer({ name: transferName, sentBytes, totalBytes }),
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

  const receiveYmodem = async () => {
    setLastError("");
    setTemplateNotice("");
    const controller = new AbortController();
    fileAbortRef.current = controller;
    setRunning(true);
    setFileTransfer({
      name: t("sender.waitYmodem"),
      sentBytes: 0,
      totalBytes: 1,
    });
    try {
      const result = await onReceiveYmodem(
        ({ fileName, receivedBytes, fileSize }) =>
          setFileTransfer({
            name: fileName,
            sentBytes: receivedBytes,
            totalBytes: fileSize,
          }),
        controller.signal,
      );
      if (result) {
        setTemplateNotice(
          t("sender.received", {
            count: result.fileCount,
            bytes: result.totalBytes.toLocaleString(locale),
          }),
        );
      } else {
        setFileTransfer(null);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setLastError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      fileAbortRef.current = null;
      setRunning(false);
    }
  };

  const receiveZmodem = async () => {
    setLastError("");
    setTemplateNotice("");
    const controller = new AbortController();
    fileAbortRef.current = controller;
    setRunning(true);
    setFileTransfer({
      name: t("sender.waitZmodem"),
      sentBytes: 0,
      totalBytes: 1,
    });
    try {
      const result = await onReceiveZmodem(
        ({ fileName, receivedBytes, fileSize }) =>
          setFileTransfer({
            name: fileName,
            sentBytes: receivedBytes,
            totalBytes: fileSize,
          }),
        controller.signal,
      );
      if (result) {
        setTemplateNotice(
          t("sender.receivedZmodem", {
            count: result.fileCount,
            bytes: result.totalBytes.toLocaleString(locale),
          }),
        );
      } else {
        setFileTransfer(null);
      }
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
    <section className="sender-pane" aria-label={t("sender.pane")}>
      <header className="sender-toolbar">
        <div className="sender-actions">
          <button
            className="toolbar-button primary"
            onClick={start}
            disabled={!connected || running || !active.payload.trim()}
            title={t("sender.send")}
          >
            <Play size={15} fill="currentColor" />
            {t("sender.send")}
          </button>
          <button
            className="toolbar-button danger"
            onClick={stop}
            disabled={!running}
            title={t("sender.stop")}
          >
            <Square size={14} fill="currentColor" />
            {t("sender.stop")}
          </button>
          <span className="toolbar-separator" />
          <button
            className="icon-button"
            onClick={addPreset}
            title={t("sender.add")}
          >
            <CirclePlus size={17} />
          </button>
          <button
            className="icon-button"
            onClick={removeActive}
            disabled={presets.length === 1}
            title={t("sender.delete")}
          >
            <Trash2 size={16} />
          </button>
          <button
            className="icon-button"
            onClick={() => void importPresets()}
            disabled={running}
            title={t("sender.import")}
            aria-label={t("sender.import")}
          >
            <Upload size={16} />
          </button>
          <button
            className="icon-button"
            onClick={() => void exportPresets()}
            disabled={running}
            title={t("sender.export")}
            aria-label={t("sender.export")}
          >
            <Download size={16} />
          </button>
          <button
            className="icon-button"
            onClick={() => updateActive({ payload: "" })}
            disabled={running || !active.payload}
            title={t("sender.clear")}
          >
            <Eraser size={16} />
          </button>
          <button
            className="icon-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!connected || running}
            title={
              fileProtocol === "raw"
                ? t("sender.file.raw")
                : fileProtocol === "xmodemCrc"
                  ? t("sender.file.xmodem")
                  : fileProtocol === "ymodem"
                    ? t("sender.file.ymodem")
                    : t("sender.file.zmodem")
            }
          >
            <FileUp size={16} />
          </button>
          <button
            className="icon-button"
            onClick={() => void receiveYmodem()}
            disabled={!connected || running}
            title={t("sender.receive.ymodem")}
            aria-label={t("sender.receive.ymodem")}
          >
            <FileDown size={16} />
          </button>
          <button
            className="icon-button"
            onClick={() => void receiveZmodem()}
            disabled={!connected || running}
            title={t("sender.receive.zmodem")}
            aria-label={t("sender.receive.zmodemLabel")}
          >
            <FolderDown size={16} />
          </button>
          <select
            className="file-protocol-select"
            value={fileProtocol}
            disabled={running}
            onChange={(event) =>
              setFileProtocol(event.target.value as FileTransferProtocol)
            }
            aria-label={t("sender.protocol")}
          >
            <option value="raw">Raw</option>
            <option value="xmodemCrc">XModem-CRC</option>
            <option value="ymodem">YModem Batch</option>
            <option value="zmodem">ZModem</option>
          </select>
          <input
            ref={fileInputRef}
            className="hidden-file-input"
            type="file"
            multiple={
              fileProtocol === "ymodem" || fileProtocol === "zmodem"
            }
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length > 0) void sendFiles(files);
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
        <button
          className="icon-button"
          onClick={onClose}
          title={t("sender.close")}
        >
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
              ? t("sender.placeholder.hex")
              : t("sender.placeholder.text")
          }
          spellCheck={false}
          aria-label={t("sender.content")}
        />
        <div className="sender-options">
          <label>
            {t("sender.name")}
            <input
              className="sender-name-input"
              value={active.name}
              disabled={running}
              onChange={(event) => updateActive({ name: event.target.value })}
            />
          </label>
          <label>
            {t("sender.mode")}
            <select
              value={active.mode}
              disabled={running}
              onChange={(event) =>
                updateActive({ mode: event.target.value as "text" | "hex" })
              }
            >
              <option value="text">{t("sender.mode.text")}</option>
              <option value="hex">Hex</option>
            </select>
          </label>
          <label>
            {t("sender.lineEnding")}
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
              <option value="none">{t("sender.lineEnding.none")}</option>
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
            {t("sender.repeat")}
          </label>
          <label>
            {t("sender.interval")}
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
            {t("sender.sentBytes", {
              count: sentBytes.toLocaleString(locale),
            })}
            {templateNotice && <span>{templateNotice}</span>}
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
