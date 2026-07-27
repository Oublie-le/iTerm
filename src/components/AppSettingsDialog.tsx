import { Download, Settings, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppPreferences, ThemeMode } from "../lib/preferences";
import { useI18n, type AppLocale } from "../lib/i18n";
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
  const { t } = useI18n();
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
      setError(t("settings.error.fontSize"));
      return;
    }
    if (
      !Number.isInteger(draft.sessionDefaults.terminal.scrollback) ||
      draft.sessionDefaults.terminal.scrollback < 0 ||
      draft.sessionDefaults.terminal.scrollback > 2_000_000
    ) {
      setError(t("settings.error.scrollback"));
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
              <h2 id="app-settings-title">{t("settings.title")}</h2>
              <p>{t("settings.subtitle")}</p>
            </div>
          </div>
          <button
            className="icon-button"
            onClick={onCancel}
            aria-label={t("settings.close")}
          >
            <X size={17} />
          </button>
        </header>

        <main className="app-settings-body">
          <section>
            <div className="page-heading">
              <h3>{t("settings.appearance.title")}</h3>
              <p>{t("settings.appearance.subtitle")}</p>
            </div>
            <div className="form-grid">
              <label className="field-row">
                <span>{t("settings.language")}</span>
                <select
                  value={draft.locale}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      locale: event.target.value as AppLocale,
                    }))
                  }
                >
                  <option value="zh-CN">{t("settings.language.zh")}</option>
                  <option value="en-US">{t("settings.language.en")}</option>
                </select>
              </label>
              <label className="field-row">
                <span>{t("settings.theme")}</span>
                <select
                  value={draft.theme}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      theme: event.target.value as ThemeMode,
                    }))
                  }
                >
                  <option value="light">{t("settings.theme.light")}</option>
                  <option value="dark">{t("settings.theme.dark")}</option>
                  <option value="system">{t("settings.theme.system")}</option>
                </select>
              </label>
              <div className="field-row">
                <span>{t("settings.closeConfirmation")}</span>
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
                  {t("settings.closeConfirmation.detail")}
                </label>
              </div>
            </div>
          </section>

          <section>
            <div className="page-heading">
              <h3>{t("settings.defaults.title")}</h3>
              <p>{t("settings.defaults.subtitle")}</p>
            </div>
            <div className="form-grid">
              <label className="field-row">
                <span>{t("settings.defaultProtocol")}</span>
                <select
                  value={draft.defaultProtocol}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      defaultProtocol: event.target.value as SessionProtocol,
                    }))
                  }
                >
                  <option value="serial">{t("settings.protocol.serial")}</option>
                  <option value="ssh">{t("settings.protocol.ssh")}</option>
                  <option value="adb">{t("settings.protocol.adb")}</option>
                </select>
              </label>
              <label className="field-row">
                <span>{t("settings.encoding")}</span>
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
                <span>{t("settings.enterKey")}</span>
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
                <span>{t("settings.backspaceKey")}</span>
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
                <span>{t("settings.fontSize")}</span>
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
                <span>{t("settings.scrollback")}</span>
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
                <span>{t("settings.timestamp")}</span>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={draft.sessionDefaults.terminal.timestamp}
                    onChange={(event) =>
                      updateTerminal({ timestamp: event.target.checked })
                    }
                  />
                  {t("settings.timestamp.detail")}
                </label>
              </div>
              <label className="field-row">
                <span>{t("settings.logMode")}</span>
                <select
                  value={draft.sessionDefaults.logging.mode}
                  onChange={(event) =>
                    updateLogging({ mode: event.target.value as LogMode })
                  }
                >
                  <option value="raw">{t("settings.logMode.raw")}</option>
                  <option value="text">{t("settings.logMode.text")}</option>
                </select>
              </label>
              <div className="field-row">
                <span>{t("settings.autoLog")}</span>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={draft.sessionDefaults.logging.autoStart}
                    onChange={(event) =>
                      updateLogging({ autoStart: event.target.checked })
                    }
                  />
                  {t("settings.autoLog.detail")}
                </label>
              </div>
            </div>
          </section>
          <section>
            <div className="page-heading">
              <h3>{t("settings.diagnostics.title")}</h3>
              <p>{t("settings.diagnostics.subtitle")}</p>
            </div>
            <div className="diagnostic-actions">
              <span>
                {t("settings.diagnostics.count", { count: diagnosticCount })}
              </span>
              <button
                className="secondary-button"
                onClick={onExportDiagnostics}
                disabled={diagnosticCount === 0}
              >
                <Download size={14} />
                {t("settings.diagnostics.export")}
              </button>
              <button
                className="secondary-button"
                onClick={onClearDiagnostics}
                disabled={diagnosticCount === 0}
              >
                <Trash2 size={14} />
                {t("settings.diagnostics.clear")}
              </button>
            </div>
          </section>
        </main>

        <footer className="dialog-footer">
          <span className="dialog-error" role="alert">
            {error}
          </span>
          <button className="secondary-button" onClick={onCancel}>
            {t("settings.cancel")}
          </button>
          <button className="primary-button" onClick={save}>
            {t("settings.save")}
          </button>
        </footer>
      </section>
    </div>
  );
}
