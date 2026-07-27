import {
  Cable,
  FileClock,
  Info,
  Monitor,
  Network,
  Plus,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  TerminalSquare,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AdbDeviceDescriptor,
  ExternalToolStatus,
  FlowControl,
  Parity,
  SerialPortDescriptor,
  SessionProtocol,
  SessionProfile,
  StopBits,
  TriggerRule,
} from "../lib/types";
import {
  createTriggerRule,
  validateTriggerRule,
} from "../lib/triggers";
import {
  useI18n,
  type TranslationKey,
} from "../lib/i18n";

type DialogPage =
  | "session"
  | "serial"
  | "ssh"
  | "adb"
  | "terminal"
  | "window"
  | "logging"
  | "triggers";

interface SessionDialogProps {
  open: boolean;
  profile: SessionProfile | null;
  ports: SerialPortDescriptor[];
  adbDevices: AdbDeviceDescriptor[];
  externalTools: ExternalToolStatus[];
  onCancel: () => void;
  onRefreshPorts: () => void;
  onRefreshAdbDevices: () => void;
  onRefreshExternalTools: () => void;
  onSave: (profile: SessionProfile, connect: boolean) => void;
}

const pages: Array<{
  id: DialogPage;
  labelKey: TranslationKey;
  icon: typeof Info;
}> = [
  { id: "session", labelKey: "dialog.page.session", icon: Info },
  { id: "serial", labelKey: "dialog.page.serial", icon: Cable },
  { id: "ssh", labelKey: "dialog.page.ssh", icon: Network },
  { id: "adb", labelKey: "dialog.page.adb", icon: Smartphone },
  { id: "terminal", labelKey: "dialog.page.terminal", icon: TerminalSquare },
  { id: "window", labelKey: "dialog.page.window", icon: Monitor },
  { id: "logging", labelKey: "dialog.page.logging", icon: FileClock },
  { id: "triggers", labelKey: "dialog.page.triggers", icon: Zap },
];

export function SessionDialog({
  open,
  profile,
  ports,
  adbDevices,
  externalTools,
  onCancel,
  onRefreshPorts,
  onRefreshAdbDevices,
  onRefreshExternalTools,
  onSave,
}: SessionDialogProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<SessionProfile | null>(profile);
  const [page, setPage] = useState<DialogPage>("session");
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(profile);
    setPage("session");
    setError("");
  }, [profile, open]);

  const selectedPort = useMemo(
    () => ports.find((port) => port.path === draft?.serial.portPath),
    [draft?.serial.portPath, ports],
  );
  const sshTool = externalTools.find((tool) => tool.id === "ssh");
  const adbTool = externalTools.find((tool) => tool.id === "adb");

  if (!open || !draft) return null;

  const update = (patch: Partial<SessionProfile>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  const updateSerial = (patch: Partial<SessionProfile["serial"]>) =>
    setDraft((current) =>
      current
        ? { ...current, serial: { ...current.serial, ...patch } }
        : current,
    );

  const updateSsh = (patch: Partial<SessionProfile["ssh"]>) =>
    setDraft((current) =>
      current ? { ...current, ssh: { ...current.ssh, ...patch } } : current,
    );

  const updateAdb = (patch: Partial<SessionProfile["adb"]>) =>
    setDraft((current) =>
      current ? { ...current, adb: { ...current.adb, ...patch } } : current,
    );

  const updateTerminal = (patch: Partial<SessionProfile["terminal"]>) =>
    setDraft((current) =>
      current
        ? { ...current, terminal: { ...current.terminal, ...patch } }
        : current,
    );

  const updateLogging = (patch: Partial<SessionProfile["logging"]>) =>
    setDraft((current) =>
      current
        ? { ...current, logging: { ...current.logging, ...patch } }
        : current,
    );

  const updateTrigger = (id: string, patch: Partial<TriggerRule>) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            triggers: current.triggers.map((trigger) =>
              trigger.id === id ? { ...trigger, ...patch } : trigger,
            ),
          }
        : current,
    );

  const submit = (connect: boolean) => {
    if (!draft.name.trim()) {
      setPage("session");
      setError(t("dialog.validation.name"));
      return;
    }
    if (connect && draft.protocol === "serial" && !draft.serial.portPath) {
      setPage("serial");
      setError(t("dialog.validation.serialPort"));
      return;
    }
    if (
      draft.protocol === "serial" &&
      !Number.isInteger(draft.serial.baudRate) ||
      draft.protocol === "serial" &&
      draft.serial.baudRate < 1
    ) {
      setPage("serial");
      setError(t("dialog.validation.baudRate"));
      return;
    }
    if (connect && draft.protocol === "ssh" && !draft.ssh.host.trim()) {
      setPage("ssh");
      setError(t("dialog.validation.sshHost"));
      return;
    }
    if (connect && draft.protocol === "ssh" && sshTool?.available === false) {
      setPage("ssh");
      setError(t("dialog.ssh.installHint"));
      return;
    }
    if (
      draft.protocol === "ssh" &&
      (!Number.isInteger(draft.ssh.port) ||
        draft.ssh.port < 1 ||
        draft.ssh.port > 65_535)
    ) {
      setPage("ssh");
      setError(t("dialog.validation.sshPort"));
      return;
    }
    if (
      connect &&
      draft.protocol === "ssh" &&
      draft.ssh.authMode === "privateKey" &&
      !draft.ssh.privateKeyPath.trim()
    ) {
      setPage("ssh");
      setError(t("dialog.validation.privateKey"));
      return;
    }
    if (
      !Number.isInteger(draft.logging.maxFileSizeMiB) ||
      draft.logging.maxFileSizeMiB < 0
    ) {
      setPage("logging");
      setError(t("dialog.validation.logSize"));
      return;
    }
    if (
      !Number.isInteger(draft.logging.rotateCount) ||
      draft.logging.rotateCount < 0 ||
      draft.logging.rotateCount > 20
    ) {
      setPage("logging");
      setError(t("dialog.validation.logRotation"));
      return;
    }
    if (connect && draft.protocol === "adb" && !draft.adb.deviceId.trim()) {
      setPage("adb");
      setError(t("dialog.validation.adbDevice"));
      return;
    }
    if (connect && draft.protocol === "adb" && adbTool?.available === false) {
      setPage("adb");
      setError(t("dialog.adb.installHint"));
      return;
    }
    for (const trigger of draft.triggers.filter((item) => item.enabled)) {
      const triggerError = validateTriggerRule(trigger);
      if (triggerError) {
        setPage("triggers");
        setError(triggerError);
        return;
      }
    }
    onSave(
      { ...draft, updatedAt: new Date().toISOString() },
      connect,
    );
  };

  const protocolDetails: Record<
    SessionProtocol,
    { label: string; description: string; icon: typeof Cable }
  > = {
    serial: {
      label: t("dialog.protocol.serial"),
      description: t("dialog.protocol.serialDescription"),
      icon: Cable,
    },
    ssh: {
      label: t("dialog.protocol.ssh"),
      description: t("dialog.protocol.sshDescription"),
      icon: Network,
    },
    adb: {
      label: t("dialog.protocol.adb"),
      description: t("dialog.protocol.adbDescription"),
      icon: Smartphone,
    },
  };
  const protocolDetail = protocolDetails[draft.protocol];
  const ProtocolIcon = protocolDetail.icon;
  const visiblePages = pages.filter(
    (item) =>
      item.id === "session" ||
      item.id === draft.protocol ||
      item.id === "terminal" ||
      item.id === "window" ||
      item.id === "logging" ||
      item.id === "triggers",
  );

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="session-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-dialog-title"
      >
        <header className="dialog-header">
          <div>
            <span className="dialog-icon">
              <ProtocolIcon size={20} />
            </span>
            <div>
              <h2 id="session-dialog-title">
                {t("dialog.title", { protocol: protocolDetail.label })}
              </h2>
              <p>{protocolDetail.description}</p>
            </div>
          </div>
          <button
            className="icon-button"
            onClick={onCancel}
            title={t("dialog.close")}
          >
            <X size={18} />
          </button>
        </header>

        <div className="dialog-content">
          <nav className="dialog-nav" aria-label={t("dialog.categories")}>
            {visiblePages.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={page === item.id ? "is-active" : ""}
                  onClick={() => {
                    setPage(item.id);
                    setError("");
                  }}
                >
                  <Icon size={17} />
                  {t(item.labelKey)}
                </button>
              );
            })}
            <div className="dialog-nav-summary">
              <SlidersHorizontal size={15} />
              <span>
                {draft.protocol === "serial"
                  ? `${draft.serial.baudRate}/${draft.serial.dataBits}/${
                      draft.serial.parity === "none"
                        ? "N"
                        : draft.serial.parity[0].toUpperCase()
                    }/${draft.serial.stopBits}`
                  : draft.protocol === "ssh"
                    ? `${draft.ssh.host || t("dialog.summary.host")}:${
                        draft.ssh.port
                      }`
                    : draft.adb.deviceId || t("dialog.summary.adbDevice")}
              </span>
            </div>
          </nav>

          <main className="dialog-page">
            {page === "session" && (
              <>
                <div className="page-heading">
                  <h3>{t("dialog.session.title")}</h3>
                  <p>{t("dialog.session.subtitle")}</p>
                </div>
                <div className="form-grid">
                  <label className="field-row">
                    <span>{t("dialog.session.protocol")}</span>
                    <select
                      value={draft.protocol}
                      onChange={(event) => {
                        const protocol = event.target.value as SessionProtocol;
                        const names: Record<SessionProtocol, string> = {
                          serial: t("dialog.defaultName.serial"),
                          ssh: t("dialog.defaultName.ssh"),
                          adb: t("dialog.defaultName.adb"),
                        };
                        const groups: Record<SessionProtocol, string> = {
                          serial: t("dialog.defaultGroup.serial"),
                          ssh: t("dialog.defaultGroup.ssh"),
                          adb: t("dialog.defaultGroup.adb"),
                        };
                        const colors: Record<SessionProtocol, string> = {
                          serial: "#17a34a",
                          ssh: "#2563eb",
                          adb: "#f59e0b",
                        };
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                protocol,
                                name: /^(新.*会话|New .+ Session)$/.test(
                                  current.name,
                                )
                                  ? names[protocol]
                                  : current.name,
                                group: groups[protocol],
                                color: colors[protocol],
                              }
                            : current,
                        );
                        setPage(protocol);
                      }}
                    >
                      <option value="serial">
                        {t("dialog.protocol.serial")}
                      </option>
                      <option value="ssh">SSH</option>
                      <option value="adb">ADB Shell</option>
                    </select>
                  </label>
                  <label className="field-row">
                    <span>{t("dialog.session.name")}</span>
                    <input
                      autoFocus
                      value={draft.name}
                      onChange={(event) => update({ name: event.target.value })}
                    />
                  </label>
                  <label className="field-row">
                    <span>{t("dialog.session.group")}</span>
                    <input
                      value={draft.group}
                      onChange={(event) => update({ group: event.target.value })}
                    />
                  </label>
                  <label className="field-row field-row-tall">
                    <span>{t("dialog.session.description")}</span>
                    <textarea
                      value={draft.description}
                      onChange={(event) =>
                        update({ description: event.target.value })
                      }
                      placeholder={t(
                        "dialog.session.descriptionPlaceholder",
                      )}
                    />
                  </label>
                  <label className="field-row">
                    <span>{t("dialog.session.color")}</span>
                    <div className="color-field">
                      <input
                        type="color"
                        value={draft.color}
                        onChange={(event) =>
                          update({ color: event.target.value })
                        }
                      />
                      <code>{draft.color.toUpperCase()}</code>
                    </div>
                  </label>
                </div>
              </>
            )}

            {page === "serial" && (
              <>
                <div className="page-heading heading-with-action">
                  <div>
                    <h3>{t("dialog.page.serial")}</h3>
                    <p>{t("dialog.serial.subtitle")}</p>
                  </div>
                  <button className="secondary-button" onClick={onRefreshPorts}>
                    <RefreshCw size={15} />
                    {t("dialog.refreshDevices")}
                  </button>
                </div>
                <div className="form-grid">
                  <label className="field-row">
                    <span>{t("dialog.serial.port")}</span>
                    <select
                      value={draft.serial.portPath}
                      onChange={(event) => {
                        const port = ports.find(
                          (item) => item.path === event.target.value,
                        );
                        updateSerial({
                          portPath: event.target.value,
                          deviceVid: port?.vid,
                          devicePid: port?.pid,
                          deviceSerialNumber: port?.serialNumber,
                        });
                        if (
                          port &&
                          (!draft.name ||
                            /^(新串口会话|New Serial Session)$/.test(
                              draft.name,
                            ))
                        ) {
                          update({ name: port.displayName });
                        }
                      }}
                    >
                      <option value="">{t("dialog.serial.select")}</option>
                      {ports.map((port) => (
                        <option key={port.path} value={port.path}>
                          {port.displayName} — {port.path}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedPort && (
                    <div className="device-summary">
                      <Cable size={17} />
                      <div>
                        <strong>{selectedPort.displayName}</strong>
                        <span>
                          {selectedPort.manufacturer ||
                            t("dialog.serial.local")}
                          {selectedPort.vid !== undefined &&
                            ` · VID ${selectedPort.vid
                              .toString(16)
                              .padStart(4, "0")
                              .toUpperCase()}`}
                          {selectedPort.pid !== undefined &&
                            ` · PID ${selectedPort.pid
                              .toString(16)
                              .padStart(4, "0")
                              .toUpperCase()}`}
                        </span>
                      </div>
                    </div>
                  )}
                  <label className="field-row">
                    <span>{t("dialog.serial.baudRate")}</span>
                    <input
                      type="number"
                      min={1}
                      max={12_000_000}
                      list="baud-rates"
                      value={draft.serial.baudRate}
                      onChange={(event) =>
                        updateSerial({
                          baudRate: Number(event.target.value),
                        })
                      }
                    />
                    <datalist id="baud-rates">
                      {[9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map(
                        (rate) => (
                          <option key={rate} value={rate} />
                        ),
                      )}
                    </datalist>
                  </label>
                  <label className="field-row">
                    <span>{t("dialog.serial.dataBits")}</span>
                    <select
                      value={draft.serial.dataBits}
                      onChange={(event) =>
                        updateSerial({
                          dataBits: Number(
                            event.target.value,
                          ) as SessionProfile["serial"]["dataBits"],
                        })
                      }
                    >
                      {[5, 6, 7, 8].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-row">
                    <span>{t("dialog.serial.parity")}</span>
                    <select
                      value={draft.serial.parity}
                      onChange={(event) =>
                        updateSerial({ parity: event.target.value as Parity })
                      }
                    >
                      <option value="none">None</option>
                      <option value="odd">Odd</option>
                      <option value="even">Even</option>
                      <option value="mark">
                        Mark ({t("dialog.serial.platformDependent")})
                      </option>
                      <option value="space">
                        Space ({t("dialog.serial.platformDependent")})
                      </option>
                    </select>
                  </label>
                  <label className="field-row">
                    <span>{t("dialog.serial.stopBits")}</span>
                    <select
                      value={draft.serial.stopBits}
                      onChange={(event) =>
                        updateSerial({
                          stopBits: event.target.value as StopBits,
                        })
                      }
                    >
                      <option value="1">1</option>
                      <option value="1.5">
                        1.5 ({t("dialog.serial.platformDependent")})
                      </option>
                      <option value="2">2</option>
                    </select>
                  </label>
                  <label className="field-row">
                    <span>{t("dialog.serial.flowControl")}</span>
                    <select
                      value={draft.serial.flowControl}
                      onChange={(event) =>
                        updateSerial({
                          flowControl: event.target.value as FlowControl,
                        })
                      }
                    >
                      <option value="none">None</option>
                      <option value="hardware">RTS/CTS</option>
                      <option value="software">XON/XOFF</option>
                    </select>
                  </label>
                  <div className="field-row">
                    <span>{t("dialog.serial.openSignals")}</span>
                    <div className="inline-checks">
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.serial.dtrOnOpen}
                          onChange={(event) =>
                            updateSerial({ dtrOnOpen: event.target.checked })
                          }
                        />
                        DTR
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.serial.rtsOnOpen}
                          onChange={(event) =>
                            updateSerial({ rtsOnOpen: event.target.checked })
                          }
                        />
                        RTS
                      </label>
                    </div>
                  </div>
                  <div className="field-row">
                    <span>{t("dialog.serial.recovery")}</span>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={draft.serial.autoReconnect}
                        onChange={(event) =>
                          updateSerial({ autoReconnect: event.target.checked })
                        }
                      />
                      {t("dialog.serial.autoReconnect")}
                    </label>
                  </div>
                </div>
              </>
            )}

            {page === "ssh" && (
              <>
                <div className="page-heading">
                  <h3>SSH</h3>
                  <p>{t("dialog.ssh.subtitle")}</p>
                </div>
                <div className="form-grid">
                  <label className="field-row">
                    <span>{t("dialog.ssh.host")}</span>
                    <input
                      value={draft.ssh.host}
                      onChange={(event) =>
                        updateSsh({ host: event.target.value })
                      }
                      placeholder={t("dialog.ssh.hostPlaceholder")}
                    />
                  </label>
                  <label className="field-row">
                    <span>{t("dialog.ssh.port")}</span>
                    <input
                      type="number"
                      min={1}
                      max={65_535}
                      value={draft.ssh.port}
                      onChange={(event) =>
                        updateSsh({ port: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label className="field-row">
                    <span>{t("dialog.ssh.username")}</span>
                    <input
                      value={draft.ssh.username}
                      onChange={(event) =>
                        updateSsh({ username: event.target.value })
                      }
                      placeholder={t("dialog.ssh.usernamePlaceholder")}
                    />
                  </label>
                  <label className="field-row">
                    <span>{t("dialog.ssh.auth")}</span>
                    <select
                      value={draft.ssh.authMode}
                      onChange={(event) =>
                        updateSsh({
                          authMode: event.target
                            .value as SessionProfile["ssh"]["authMode"],
                        })
                      }
                    >
                      <option value="agent">
                        {t("dialog.ssh.auth.agent")}
                      </option>
                      <option value="privateKey">
                        {t("dialog.ssh.auth.privateKey")}
                      </option>
                      <option value="password">
                        {t("dialog.ssh.auth.password")}
                      </option>
                    </select>
                  </label>
                  {draft.ssh.authMode === "privateKey" && (
                    <label className="field-row">
                      <span>{t("dialog.ssh.privateKeyPath")}</span>
                      <input
                        value={draft.ssh.privateKeyPath}
                        onChange={(event) =>
                          updateSsh({ privateKeyPath: event.target.value })
                        }
                        placeholder="/Users/name/.ssh/id_ed25519"
                      />
                    </label>
                  )}
                  <div className="field-row">
                    <span>{t("dialog.ssh.hostKey")}</span>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={draft.ssh.strictHostKeyChecking}
                        onChange={(event) =>
                          updateSsh({
                            strictHostKeyChecking: event.target.checked,
                          })
                        }
                      />
                      {t("dialog.ssh.strictHostKey")}
                    </label>
                  </div>
                  <label className="field-row">
                    <span>{t("dialog.ssh.keepAlive")}</span>
                    <input
                      type="number"
                      min={0}
                      max={3600}
                      value={draft.ssh.keepAliveSeconds}
                      onChange={(event) =>
                        updateSsh({
                          keepAliveSeconds: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </div>
                {draft.ssh.authMode === "password" && (
                  <div className="settings-note">
                    {t("dialog.ssh.passwordNote")}
                  </div>
                )}
                <div
                  className={`settings-note tool-status ${
                    sshTool?.available === false ? "is-missing" : ""
                  }`}
                >
                  <Network size={17} />
                  <div>
                    <strong>
                      {sshTool?.available === false
                        ? t("dialog.ssh.missing")
                        : t("dialog.ssh.ready")}
                    </strong>
                    <span>
                      {sshTool?.available === false
                        ? t("dialog.ssh.installHint")
                        : sshTool?.version || t("dialog.ssh.pathReady")}
                    </span>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={onRefreshExternalTools}
                  >
                    <RefreshCw size={13} />
                    {t("dialog.detectAgain")}
                  </button>
                </div>
              </>
            )}

            {page === "adb" && (
              <>
                <div className="page-heading heading-with-action">
                  <div>
                    <h3>ADB Shell</h3>
                    <p>{t("dialog.adb.subtitle")}</p>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={onRefreshAdbDevices}
                  >
                    <RefreshCw size={15} />
                    {t("dialog.refreshDevices")}
                  </button>
                </div>
                <div className="form-grid">
                  <label className="field-row">
                    <span>{t("dialog.adb.deviceId")}</span>
                    <input
                      list="adb-device-ids"
                      value={draft.adb.deviceId}
                      onChange={(event) =>
                        updateAdb({ deviceId: event.target.value })
                      }
                      placeholder={t("dialog.adb.devicePlaceholder")}
                    />
                    <datalist id="adb-device-ids">
                      {adbDevices.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.model || device.product || device.id} ·{" "}
                          {device.state}
                        </option>
                      ))}
                    </datalist>
                  </label>
                  {draft.adb.deviceId &&
                    (() => {
                      const device = adbDevices.find(
                        (item) => item.id === draft.adb.deviceId,
                      );
                      return device ? (
                        <div className="device-summary">
                          <Smartphone size={17} />
                          <div>
                            <strong>{device.model || device.id}</strong>
                            <span>
                              {device.id} ·{" "}
                              {device.state === "device"
                                ? t("dialog.adb.authorized")
                                : device.state === "unauthorized"
                                  ? t("dialog.adb.awaitingAuthorization")
                                  : device.state}
                            </span>
                          </div>
                        </div>
                      ) : null;
                    })()}
                  <label className="field-row">
                    <span>{t("dialog.adb.shell")}</span>
                    <input
                      value={draft.adb.shell}
                      onChange={(event) =>
                        updateAdb({ shell: event.target.value })
                      }
                      placeholder={t("dialog.adb.shellPlaceholder")}
                    />
                  </label>
                  <div
                    className={`settings-note tool-status ${
                      adbTool?.available === false ? "is-missing" : ""
                    }`}
                  >
                    <Smartphone size={17} />
                    <div>
                      <strong>
                        {adbTool?.available === false
                          ? t("dialog.adb.missing")
                          : t("dialog.adb.ready")}
                      </strong>
                      <span>
                        {adbTool?.available === false
                          ? t("dialog.adb.installHint")
                          : adbTool?.version || t("dialog.adb.pathReady")}
                      </span>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={onRefreshExternalTools}
                    >
                      <RefreshCw size={13} />
                      {t("dialog.detectAgain")}
                    </button>
                  </div>
                </div>
              </>
            )}

            {page === "terminal" && (
              <>
                <div className="page-heading">
                  <h3>终端</h3>
                  <p>配置字符集、终端类型和字体。</p>
                </div>
                <div className="form-grid">
                  <label className="field-row">
                    <span>字符集</span>
                    <select
                      value={draft.terminal.encoding}
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
                    <span>终端类型</span>
                    <select
                      value={draft.terminal.termType}
                      onChange={(event) =>
                        updateTerminal({ termType: event.target.value })
                      }
                    >
                      <option value="xterm-256color">xterm-256color</option>
                      <option value="xterm">xterm</option>
                      <option value="vt100">vt100</option>
                      <option value="vt220">vt220</option>
                    </select>
                  </label>
                  <label className="field-row">
                    <span>Enter 键</span>
                    <select
                      value={draft.terminal.enterKey}
                      onChange={(event) =>
                        updateTerminal({
                          enterKey: event.target
                            .value as SessionProfile["terminal"]["enterKey"],
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
                      value={draft.terminal.backspaceKey}
                      onChange={(event) =>
                        updateTerminal({
                          backspaceKey: event.target
                            .value as SessionProfile["terminal"]["backspaceKey"],
                        })
                      }
                    >
                      <option value="del">DEL（0x7F）</option>
                      <option value="bs">BS（0x08）</option>
                    </select>
                  </label>
                  <label className="field-row">
                    <span>字体</span>
                    <input
                      value={draft.terminal.fontFamily}
                      onChange={(event) =>
                        updateTerminal({ fontFamily: event.target.value })
                      }
                    />
                  </label>
                  <label className="field-row">
                    <span>字号</span>
                    <input
                      type="number"
                      min={8}
                      max={40}
                      value={draft.terminal.fontSize}
                      onChange={(event) =>
                        updateTerminal({
                          fontSize: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field-row">
                    <span>光标</span>
                    <select
                      value={draft.terminal.cursorStyle}
                      onChange={(event) =>
                        updateTerminal({
                          cursorStyle: event.target
                            .value as SessionProfile["terminal"]["cursorStyle"],
                        })
                      }
                    >
                      <option value="block">块</option>
                      <option value="bar">竖线</option>
                      <option value="underline">下划线</option>
                    </select>
                  </label>
                </div>
              </>
            )}

            {page === "window" && (
              <>
                <div className="page-heading">
                  <h3>窗口</h3>
                  <p>控制回滚、时间戳和终端尺寸行为。</p>
                </div>
                <div className="form-grid">
                  <label className="field-row">
                    <span>回滚行数</span>
                    <input
                      type="number"
                      min={0}
                      max={2_000_000}
                      value={draft.terminal.scrollback}
                      onChange={(event) =>
                        updateTerminal({
                          scrollback: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <div className="field-row">
                    <span>行时间戳</span>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={draft.terminal.timestamp}
                        onChange={(event) =>
                          updateTerminal({ timestamp: event.target.checked })
                        }
                      />
                      在终端左侧显示接收时间
                    </label>
                  </div>
                  <label className="field-row">
                    <span>Hex 每行字节</span>
                    <select
                      value={draft.terminal.hexColumns}
                      onChange={(event) =>
                        updateTerminal({
                          hexColumns: Number(
                            event.target.value,
                          ) as SessionProfile["terminal"]["hexColumns"],
                        })
                      }
                    >
                      {[8, 16, 24, 32].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-row">
                    <span>Hex 字节分组</span>
                    <select
                      value={draft.terminal.hexGroupSize}
                      onChange={(event) =>
                        updateTerminal({
                          hexGroupSize: Number(
                            event.target.value,
                          ) as SessionProfile["terminal"]["hexGroupSize"],
                        })
                      }
                    >
                      {[1, 2, 4, 8].map((value) => (
                        <option key={value} value={value}>
                          {value} 字节
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="settings-note">
                    <Settings2 size={17} />
                    终端行列会随窗口尺寸自动调整，当前值显示在底部状态栏。
                  </div>
                </div>
              </>
            )}

            {page === "logging" && (
              <>
                <div className="page-heading">
                  <h3>日志</h3>
                  <p>将当前会话的接收数据保存到本机应用日志目录。</p>
                </div>
                <div className="form-grid">
                  <label className="field-row">
                    <span>日志模式</span>
                    <select
                      value={draft.logging.mode}
                      onChange={(event) =>
                        updateLogging({
                          mode: event.target.value as "raw" | "text",
                        })
                      }
                    >
                      <option value="raw">原始字节（无损）</option>
                      <option value="text">可读文本（带行时间戳）</option>
                    </select>
                  </label>
                  <div className="field-row">
                    <span>写入方式</span>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={draft.logging.append}
                        onChange={(event) =>
                          updateLogging({ append: event.target.checked })
                        }
                      />
                      文件已存在时追加内容
                    </label>
                  </div>
                  <div className="field-row">
                    <span>自动记录</span>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={draft.logging.autoStart}
                        onChange={(event) =>
                          updateLogging({ autoStart: event.target.checked })
                        }
                      />
                      会话连接成功后自动开始
                    </label>
                  </div>
                  <label className="field-row">
                    <span>单文件上限</span>
                    <input
                      type="number"
                      min={0}
                      max={102_400}
                      value={draft.logging.maxFileSizeMiB}
                      onChange={(event) =>
                        updateLogging({
                          maxFileSizeMiB: Number(event.target.value),
                        })
                      }
                    />
                    <small>MiB，0 表示不限制</small>
                  </label>
                  <label className="field-row">
                    <span>轮转保留</span>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={draft.logging.rotateCount}
                      disabled={draft.logging.maxFileSizeMiB === 0}
                      onChange={(event) =>
                        updateLogging({
                          rotateCount: Number(event.target.value),
                        })
                      }
                    />
                    <small>最多保留 20 份旧日志</small>
                  </label>
                  <div className="settings-note">
                    <FileClock size={17} />
                    日志按“会话名_日期_时间.log”命名。原始模式逐字节保存，
                    文本模式按当前会话字符集增量解码；达到上限后自动轮转为
                    .1、.2 等备份。
                  </div>
                </div>
              </>
            )}

            {page === "triggers" && (
              <>
                <div className="page-heading heading-with-action">
                  <div>
                    <h3>触发器</h3>
                    <p>接收内容匹配后自动执行动作，并通过冷却和次数限制防止循环。</p>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              triggers: [
                                ...current.triggers,
                                createTriggerRule(current.triggers.length + 1),
                              ],
                            }
                          : current,
                      )
                    }
                  >
                    <Plus size={14} />
                    添加触发器
                  </button>
                </div>
                {draft.triggers.length === 0 ? (
                  <div className="coming-soon-card">
                    <Zap size={18} />
                    <div>
                      <strong>尚未配置触发器</strong>
                      <p>添加规则后，可在串口、SSH 或 ADB 输出中自动匹配并执行动作。</p>
                    </div>
                  </div>
                ) : (
                  <div className="trigger-list">
                    {draft.triggers.map((trigger) => (
                      <section className="trigger-card" key={trigger.id}>
                        <header>
                          <label>
                            <input
                              type="checkbox"
                              checked={trigger.enabled}
                              onChange={(event) =>
                                updateTrigger(trigger.id, {
                                  enabled: event.target.checked,
                                })
                              }
                            />
                            启用
                          </label>
                          <input
                            aria-label="触发器名称"
                            value={trigger.name}
                            onChange={(event) =>
                              updateTrigger(trigger.id, {
                                name: event.target.value,
                              })
                            }
                          />
                          <button
                            className="icon-button"
                            type="button"
                            title={`删除 ${trigger.name}`}
                            onClick={() =>
                              setDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      triggers: current.triggers.filter(
                                        (item) => item.id !== trigger.id,
                                      ),
                                    }
                                  : current,
                              )
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </header>
                        <div className="trigger-grid">
                          <label>
                            <span>匹配方式</span>
                            <select
                              value={trigger.matcher}
                              onChange={(event) =>
                                updateTrigger(trigger.id, {
                                  matcher: event.target
                                    .value as TriggerRule["matcher"],
                                })
                              }
                            >
                              <option value="text">文本</option>
                              <option value="regex">正则表达式</option>
                            </select>
                          </label>
                          <label className="trigger-pattern">
                            <span>匹配内容</span>
                            <input
                              value={trigger.pattern}
                              placeholder={
                                trigger.matcher === "regex"
                                  ? "例如：error\\s+\\d+"
                                  : "例如：READY>"
                              }
                              onChange={(event) =>
                                updateTrigger(trigger.id, {
                                  pattern: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label className="trigger-check">
                            <input
                              type="checkbox"
                              checked={trigger.caseSensitive}
                              onChange={(event) =>
                                updateTrigger(trigger.id, {
                                  caseSensitive: event.target.checked,
                                })
                              }
                            />
                            区分大小写
                          </label>
                          <label>
                            <span>动作</span>
                            <select
                              value={trigger.action}
                              onChange={(event) =>
                                updateTrigger(trigger.id, {
                                  action: event.target
                                    .value as TriggerRule["action"],
                                })
                              }
                            >
                              <option value="notification">显示通知</option>
                              <option value="sendText">发送文本</option>
                              <option value="startLog">开始日志</option>
                            </select>
                          </label>
                          {trigger.action !== "startLog" && (
                            <label className="trigger-pattern">
                              <span>
                                {trigger.action === "sendText"
                                  ? "发送内容"
                                  : "通知内容"}
                              </span>
                              <input
                                value={trigger.payload}
                                onChange={(event) =>
                                  updateTrigger(trigger.id, {
                                    payload: event.target.value,
                                  })
                                }
                              />
                            </label>
                          )}
                          <label>
                            <span>冷却时间</span>
                            <input
                              type="number"
                              min={0}
                              value={trigger.cooldownMs}
                              onChange={(event) =>
                                updateTrigger(trigger.id, {
                                  cooldownMs: Number(event.target.value),
                                })
                              }
                            />
                            <small>毫秒</small>
                          </label>
                          <label>
                            <span>最大次数</span>
                            <input
                              type="number"
                              min={0}
                              value={trigger.maxTriggers}
                              onChange={(event) =>
                                updateTrigger(trigger.id, {
                                  maxTriggers: Number(event.target.value),
                                })
                              }
                            />
                            <small>0 表示不限</small>
                          </label>
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </>
            )}
          </main>
        </div>

        <footer className="dialog-footer">
          <div className="dialog-error" role="alert">
            {error}
          </div>
          <button className="secondary-button" onClick={onCancel}>
            取消
          </button>
          <button className="secondary-button" onClick={() => submit(false)}>
            保存
          </button>
          <button className="primary-button" onClick={() => submit(true)}>
            保存并连接
          </button>
        </footer>
      </section>
    </div>
  );
}
