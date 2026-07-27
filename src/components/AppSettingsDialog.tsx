import { Download, Settings, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppPreferences, ThemeMode } from "../lib/preferences";
import type {
  LogMode,
  SessionProtocol,
  TerminalConfig,
} from "../lib/types";

interface AppSettingsDialogProps {
  open: boolean;
  preferences: AppPreferences;
  onCancel: () => void;
  onSave: (preferences: AppPreferences) => void;
  diagnosticCount: number;
  onExportDiagnostics: () => void;
  onClearDiagnostics: () => void;
}

export function AppSettingsDialog({
  open,
  preferences,
  onCancel,
  onSave,
  diagnosticCount,
  onExportDiagnostics,
  onClearDiagnostics,
}: AppSettingsDialogProps) {
  const [draft, setDraft] = useState(preferences);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(preferences);
    setError("");
  }, [open, preferences]);

  if (!open) return null;

  const updateTerminal = (patch: Partial<TerminalConfig>) =>
    setDraft((current) => ({
      ...current,
      sessionDefaults: {
        ...current.sessionDefaults,
        terminal: { ...current.sessionDefaults.terminal, ...patch },
      },
    }));

  const updateLogging = (
    patch: Partial<AppPreferences["sessionDefaults"]["logging"]>,
  ) =>
    setDraft((current) => ({
      ...current,
      sessionDefaults: {
        ...current.sessionDefaults,
        logging: { ...current.sessionDefaults.logging, ...patch },
      },
    }));

  const save = () => {
    if (
      !Number.isInteger(draft.sessionDefaults.terminal.fontSize) ||
      draft.sessionDefaults.terminal.fontSize < 8 ||
      draft.sessionDefaults.terminal.fontSize > 40
    ) {
      setError("默认字号必须是 8–40 的整数。");
      return;
    }
    if (
      !Number.isInteger(draft.sessionDefaults.terminal.scrollback) ||
      draft.sessionDefaults.terminal.scrollback < 0 ||
      draft.sessionDefaults.terminal.scrollback > 2_000_000
    ) {
      setError("默认回滚行数必须是 0–2,000,000 的整数。");
      return;
    }
    onSave(draft);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="app-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-settings-title"
      >
        <header className="dialog-header">
          <div>
            <span className="dialog-icon">
              <Settings size={20} />
            </span>
            <div>
              <h2 id="app-settings-title">应用设置</h2>
              <p>应用级默认值只应用于之后创建的新会话。</p>
            </div>
          </div>
          <button
            className="icon-button"
            onClick={onCancel}
            aria-label="关闭应用设置"
          >
            <X size={17} />
          </button>
        </header>

        <main className="app-settings-body">
          <section>
            <div className="page-heading">
              <h3>外观与行为</h3>
              <p>控制整个应用的显示和安全确认。</p>
            </div>
            <div className="form-grid">
              <label className="field-row">
                <span>主题</span>
                <select
                  value={draft.theme}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      theme: event.target.value as ThemeMode,
                    }))
                  }
                >
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                  <option value="system">跟随系统</option>
                </select>
              </label>
              <div className="field-row">
                <span>关闭确认</span>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={draft.confirmActiveSessionClose}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        confirmActiveSessionClose: event.target.checked,
                      }))
                    }
                  />
                  关闭活动会话或退出应用前确认
                </label>
              </div>
            </div>
          </section>

          <section>
            <div className="page-heading">
              <h3>新会话默认值</h3>
              <p>当前会话保存的设置始终优先于这些默认值。</p>
            </div>
            <div className="form-grid">
              <label className="field-row">
                <span>默认协议</span>
                <select
                  value={draft.defaultProtocol}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      defaultProtocol: event.target.value as SessionProtocol,
                    }))
                  }
                >
                  <option value="serial">串口</option>
                  <option value="ssh">SSH</option>
                  <option value="adb">ADB Shell</option>
                </select>
              </label>
              <label className="field-row">
                <span>字符集</span>
                <select
                  value={draft.sessionDefaults.terminal.encoding}
                  onChange={(event) =>
                    updateTerminal({ encoding: event.target.value })
                  }
                >
                  <option value="utf-8">UTF-8</option>
                  <option value="gbk">GB18030 / GBK</option>
                  <option value="big5">Big5</option>
                  <option value="shift_jis">Shift-JIS</option>
                  <option value="windows-1252">ISO-8859-1</option>
                </select>
              </label>
              <label className="field-row">
                <span>Enter 键</span>
                <select
                  value={draft.sessionDefaults.terminal.enterKey}
                  onChange={(event) =>
                    updateTerminal({
                      enterKey: event.target.value as TerminalConfig["enterKey"],
                    })
                  }
                >
                  <option value="cr">CR</option>
                  <option value="lf">LF</option>
                  <option value="crlf">CRLF</option>
                </select>
              </label>
              <label className="field-row">
                <span>Backspace 键</span>
                <select
                  value={draft.sessionDefaults.terminal.backspaceKey}
                  onChange={(event) =>
                    updateTerminal({
                      backspaceKey: event.target
                        .value as TerminalConfig["backspaceKey"],
                    })
                  }
                >
                  <option value="del">DEL（0x7F）</option>
                  <option value="bs">BS（0x08）</option>
                </select>
              </label>
              <label className="field-row">
                <span>字号</span>
                <input
                  type="number"
                  min={8}
                  max={40}
                  value={draft.sessionDefaults.terminal.fontSize}
                  onChange={(event) =>
                    updateTerminal({ fontSize: Number(event.target.value) })
                  }
                />
              </label>
              <label className="field-row">
                <span>回滚行数</span>
                <input
                  type="number"
                  min={0}
                  max={2_000_000}
                  value={draft.sessionDefaults.terminal.scrollback}
                  onChange={(event) =>
                    updateTerminal({ scrollback: Number(event.target.value) })
                  }
                />
              </label>
              <div className="field-row">
                <span>时间戳</span>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={draft.sessionDefaults.terminal.timestamp}
                    onChange={(event) =>
                      updateTerminal({ timestamp: event.target.checked })
                    }
                  />
                  新会话默认显示行时间戳
                </label>
              </div>
              <label className="field-row">
                <span>日志模式</span>
                <select
                  value={draft.sessionDefaults.logging.mode}
                  onChange={(event) =>
                    updateLogging({ mode: event.target.value as LogMode })
                  }
                >
                  <option value="raw">原始字节</option>
                  <option value="text">可读文本</option>
                </select>
              </label>
              <div className="field-row">
                <span>自动日志</span>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={draft.sessionDefaults.logging.autoStart}
                    onChange={(event) =>
                      updateLogging({ autoStart: event.target.checked })
                    }
                  />
                  新会话连接后自动开始日志
                </label>
              </div>
            </div>
          </section>
          <section>
            <div className="page-heading">
              <h3>本地诊断</h3>
              <p>记录连接、日志和文件传输状态，不记录终端收发内容或凭据。</p>
            </div>
            <div className="diagnostic-actions">
              <span>当前保留 {diagnosticCount} / 500 条结构化事件</span>
              <button
                className="secondary-button"
                onClick={onExportDiagnostics}
                disabled={diagnosticCount === 0}
              >
                <Download size={14} />
                导出诊断
              </button>
              <button
                className="secondary-button"
                onClick={onClearDiagnostics}
                disabled={diagnosticCount === 0}
              >
                <Trash2 size={14} />
                清空诊断
              </button>
            </div>
          </section>
        </main>

        <footer className="dialog-footer">
          <span className="dialog-error" role="alert">
            {error}
          </span>
          <button className="secondary-button" onClick={onCancel}>
            取消
          </button>
          <button className="primary-button" onClick={save}>
            保存应用设置
          </button>
        </footer>
      </section>
    </div>
  );
}
