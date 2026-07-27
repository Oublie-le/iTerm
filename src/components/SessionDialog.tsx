import {
  ArrowRight,
  Cable,
  FileClock,
  Info,
  KeyRound,
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
  SshConfigHost,
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
  sshConfigHosts: SshConfigHost[];
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
  sshConfigHosts,
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

  const useSshConfigHost = (host: SshConfigHost, connect: boolean) => {
    const next: SessionProfile = {
      ...draft,
      ssh: {
        ...draft.ssh,
        host: host.alias,
        port: host.port ?? 22,
        username: host.user ?? "",
        authMode: "agent",
        privateKeyPath: "",
      },
      updatedAt: new Date().toISOString(),
    };
    setDraft(next);
    if (connect) onSave(next, true);
  };

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
      const triggerError = validateTriggerRule(trigger, {
        nameRequired: t("dialog.validation.triggerName"),
        patternRequired: (name) =>
          t("dialog.validation.triggerPattern", { name }),
        cooldownInvalid: (name) =>
          t("dialog.validation.triggerCooldown", { name }),
        maxTriggersInvalid: (name) =>
          t("dialog.validation.triggerMaxCount", { name }),
        payloadRequired: (name) =>
          t("dialog.validation.triggerPayload", { name }),
        regexMatchesEmpty: (name) =>
          t("dialog.validation.triggerRegexEmpty", { name }),
        regexInvalid: (name, reason) =>
          t("dialog.validation.triggerRegexInvalid", { name, reason }),
      });
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
                <div className="page-heading heading-with-action">
                  <div>
                    <h3>SSH</h3>
                    <p>{t("dialog.ssh.subtitle")}</p>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={onRefreshExternalTools}
                  >
                    <RefreshCw size={14} />
                    {t("dialog.ssh.refreshConfig")}
                  </button>
                </div>
                <section className="ssh-config-browser">
                  <div className="ssh-config-browser-heading">
                    <div>
                      <strong>{t("dialog.ssh.detectedHosts")}</strong>
                      <span>
                        {sshConfigHosts.length
                          ? t("dialog.ssh.detectedCount", {
                              count: sshConfigHosts.length,
                            })
                          : t("dialog.ssh.noDetectedHosts")}
                      </span>
                    </div>
                    <code>~/.ssh/config</code>
                  </div>
                  {sshConfigHosts.length > 0 && (
                    <div className="ssh-config-hosts">
                      {sshConfigHosts.map((host) => (
                        <article className="ssh-config-host" key={host.alias}>
                          <div className="ssh-config-host-icon">
                            <Network size={16} />
                          </div>
                          <div className="ssh-config-host-summary">
                            <strong>{host.alias}</strong>
                            <span>
                              {host.user ? `${host.user}@` : ""}
                              {host.hostName || host.alias}:{host.port ?? 22}
                            </span>
                            <div className="ssh-config-badges">
                              {host.identityFiles.length > 0 && (
                                <span title={host.identityFiles.join("\n")}>
                                  <KeyRound size={11} />
                                  {t("dialog.ssh.keyConfigured")}
                                </span>
                              )}
                              {host.proxyJump && (
                                <span>
                                  {t("dialog.ssh.via")} {host.proxyJump}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="ssh-config-host-actions">
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => useSshConfigHost(host, false)}
                            >
                              {t("dialog.ssh.fill")}
                            </button>
                            <button
                              className="primary-button compact-button"
                              type="button"
                              onClick={() => useSshConfigHost(host, true)}
                            >
                              {t("dialog.ssh.connectNow")}
                              <ArrowRight size={13} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
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
                  <h3>{t("dialog.terminal.title")}</h3>
                  <p>{t("dialog.terminal.subtitle")}</p>
                </div>
                <div className="form-grid">
                  <label className="field-row">
                    <span>{t("dialog.terminal.encoding")}</span>
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
                    <span>{t("dialog.terminal.type")}</span>
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
                    <span>{t("dialog.terminal.enterKey")}</span>
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
                    <span>{t("dialog.terminal.backspaceKey")}</span>
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
                    <span>{t("dialog.terminal.font")}</span>
                    <input
                      value={draft.terminal.fontFamily}
                      onChange={(event) =>
                        updateTerminal({ fontFamily: event.target.value })
                      }
                    />
                  </label>
                  <label className="field-row">
                    <span>{t("dialog.terminal.fontSize")}</span>
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
                    <span>{t("dialog.terminal.cursor")}</span>
                    <select
                      value={draft.terminal.cursorStyle}
                      onChange={(event) =>
                        updateTerminal({
                          cursorStyle: event.target
                            .value as SessionProfile["terminal"]["cursorStyle"],
                        })
                      }
                    >
                      <option value="block">
                        {t("dialog.terminal.cursor.block")}
                      </option>
                      <option value="bar">
                        {t("dialog.terminal.cursor.bar")}
                      </option>
                      <option value="underline">
                        {t("dialog.terminal.cursor.underline")}
                      </option>
                    </select>
                  </label>
                </div>
              </>
            )}

            {page === "window" && (
              <>
                <div className="page-heading">
                  <h3>{t("dialog.window.title")}</h3>
                  <p>{t("dialog.window.subtitle")}</p>
                </div>
                <div className="form-grid">
                  <label className="field-row">
                    <span>{t("dialog.window.scrollback")}</span>
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
                    <span>{t("dialog.window.timestamp")}</span>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={draft.terminal.timestamp}
                        onChange={(event) =>
                          updateTerminal({ timestamp: event.target.checked })
                        }
                      />
                      {t("dialog.window.timestampDetail")}
                    </label>
                  </div>
                  {draft.protocol === "serial" && (
                    <div className="field-row">
                      <span>{t("dialog.window.semanticColors")}</span>
                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={draft.terminal.semanticColors}
                          onChange={(event) =>
                            updateTerminal({
                              semanticColors: event.target.checked,
                            })
                          }
                        />
                        {t("dialog.window.semanticColorsDetail")}
                      </label>
                    </div>
                  )}
                  <label className="field-row">
                    <span>{t("dialog.window.hexColumns")}</span>
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
                    <span>{t("dialog.window.hexGroup")}</span>
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
                          {t("dialog.window.bytes", { value })}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="settings-note">
                    <Settings2 size={17} />
                    {t("dialog.window.note")}
                  </div>
                </div>
              </>
            )}

            {page === "logging" && (
              <>
                <div className="page-heading">
                  <h3>{t("dialog.logging.title")}</h3>
                  <p>{t("dialog.logging.subtitle")}</p>
                </div>
                <div className="form-grid">
                  <label className="field-row">
                    <span>{t("dialog.logging.mode")}</span>
                    <select
                      value={draft.logging.mode}
                      onChange={(event) =>
                        updateLogging({
                          mode: event.target.value as "raw" | "text",
                        })
                      }
                    >
                      <option value="raw">
                        {t("dialog.logging.mode.raw")}
                      </option>
                      <option value="text">
                        {t("dialog.logging.mode.text")}
                      </option>
                    </select>
                  </label>
                  <div className="field-row">
                    <span>{t("dialog.logging.writeMode")}</span>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={draft.logging.append}
                        onChange={(event) =>
                          updateLogging({ append: event.target.checked })
                        }
                      />
                      {t("dialog.logging.append")}
                    </label>
                  </div>
                  <div className="field-row">
                    <span>{t("dialog.logging.auto")}</span>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={draft.logging.autoStart}
                        onChange={(event) =>
                          updateLogging({ autoStart: event.target.checked })
                        }
                      />
                      {t("dialog.logging.autoDetail")}
                    </label>
                  </div>
                  <label className="field-row">
                    <span>{t("dialog.logging.maxSize")}</span>
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
                    <small>{t("dialog.logging.maxSizeHint")}</small>
                  </label>
                  <label className="field-row">
                    <span>{t("dialog.logging.rotation")}</span>
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
                    <small>{t("dialog.logging.rotationHint")}</small>
                  </label>
                  <div className="settings-note">
                    <FileClock size={17} />
                    {t("dialog.logging.note")}
                  </div>
                </div>
              </>
            )}

            {page === "triggers" && (
              <>
                <div className="page-heading heading-with-action">
                  <div>
                    <h3>{t("dialog.triggers.title")}</h3>
                    <p>{t("dialog.triggers.subtitle")}</p>
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
                                createTriggerRule(
                                  current.triggers.length + 1,
                                  t("dialog.triggers.defaultName"),
                                  t("dialog.triggers.defaultPayload"),
                                ),
                              ],
                            }
                          : current,
                      )
                    }
                  >
                    <Plus size={14} />
                    {t("dialog.triggers.add")}
                  </button>
                </div>
                {draft.triggers.length === 0 ? (
                  <div className="coming-soon-card">
                    <Zap size={18} />
                    <div>
                      <strong>{t("dialog.triggers.empty")}</strong>
                      <p>{t("dialog.triggers.emptyDetail")}</p>
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
                            {t("dialog.triggers.enabled")}
                          </label>
                          <input
                            aria-label={t("dialog.triggers.name")}
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
                            title={t("dialog.triggers.delete", {
                              name: trigger.name,
                            })}
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
                            <span>{t("dialog.triggers.matcher")}</span>
                            <select
                              value={trigger.matcher}
                              onChange={(event) =>
                                updateTrigger(trigger.id, {
                                  matcher: event.target
                                    .value as TriggerRule["matcher"],
                                })
                              }
                            >
                              <option value="text">
                                {t("dialog.triggers.matcher.text")}
                              </option>
                              <option value="regex">
                                {t("dialog.triggers.matcher.regex")}
                              </option>
                            </select>
                          </label>
                          <label className="trigger-pattern">
                            <span>{t("dialog.triggers.pattern")}</span>
                            <input
                              value={trigger.pattern}
                              placeholder={
                                trigger.matcher === "regex"
                                  ? t(
                                      "dialog.triggers.pattern.regexPlaceholder",
                                    )
                                  : t(
                                      "dialog.triggers.pattern.textPlaceholder",
                                    )
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
                            {t("dialog.triggers.caseSensitive")}
                          </label>
                          <label>
                            <span>{t("dialog.triggers.action")}</span>
                            <select
                              value={trigger.action}
                              onChange={(event) =>
                                updateTrigger(trigger.id, {
                                  action: event.target
                                    .value as TriggerRule["action"],
                                })
                              }
                            >
                              <option value="notification">
                                {t("dialog.triggers.action.notification")}
                              </option>
                              <option value="sendText">
                                {t("dialog.triggers.action.sendText")}
                              </option>
                              <option value="startLog">
                                {t("dialog.triggers.action.startLog")}
                              </option>
                            </select>
                          </label>
                          {trigger.action !== "startLog" && (
                            <label className="trigger-pattern">
                              <span>
                                {trigger.action === "sendText"
                                  ? t("dialog.triggers.payload.send")
                                  : t("dialog.triggers.payload.notification")}
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
                            <span>{t("dialog.triggers.cooldown")}</span>
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
                            <small>{t("dialog.triggers.milliseconds")}</small>
                          </label>
                          <label>
                            <span>{t("dialog.triggers.maxCount")}</span>
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
                            <small>{t("dialog.triggers.unlimited")}</small>
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
            {t("dialog.actions.cancel")}
          </button>
          <button className="secondary-button" onClick={() => submit(false)}>
            {t("dialog.actions.save")}
          </button>
          <button className="primary-button" onClick={() => submit(true)}>
            {t("dialog.actions.saveConnect")}
          </button>
        </footer>
      </section>
    </div>
  );
}
