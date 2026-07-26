import {
  Cable,
  FileClock,
  Info,
  Monitor,
  Network,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  TerminalSquare,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AdbDeviceDescriptor,
  FlowControl,
  Parity,
  SerialPortDescriptor,
  SessionProtocol,
  SessionProfile,
  StopBits,
} from "../lib/types";

type DialogPage =
  | "session"
  | "serial"
  | "ssh"
  | "adb"
  | "terminal"
  | "window"
  | "logging";

interface SessionDialogProps {
  open: boolean;
  profile: SessionProfile | null;
  ports: SerialPortDescriptor[];
  adbDevices: AdbDeviceDescriptor[];
  onCancel: () => void;
  onRefreshPorts: () => void;
  onRefreshAdbDevices: () => void;
  onSave: (profile: SessionProfile, connect: boolean) => void;
}

const pages: Array<{
  id: DialogPage;
  label: string;
  icon: typeof Info;
}> = [
  { id: "session", label: "会话", icon: Info },
  { id: "serial", label: "串口", icon: Cable },
  { id: "ssh", label: "SSH", icon: Network },
  { id: "adb", label: "ADB", icon: Smartphone },
  { id: "terminal", label: "终端", icon: TerminalSquare },
  { id: "window", label: "窗口", icon: Monitor },
  { id: "logging", label: "日志", icon: FileClock },
];

export function SessionDialog({
  open,
  profile,
  ports,
  adbDevices,
  onCancel,
  onRefreshPorts,
  onRefreshAdbDevices,
  onSave,
}: SessionDialogProps) {
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

  const submit = (connect: boolean) => {
    if (!draft.name.trim()) {
      setPage("session");
      setError("请输入会话名称。");
      return;
    }
    if (connect && draft.protocol === "serial" && !draft.serial.portPath) {
      setPage("serial");
      setError("请选择串口设备。");
      return;
    }
    if (
      draft.protocol === "serial" &&
      !Number.isInteger(draft.serial.baudRate) ||
      draft.protocol === "serial" &&
      draft.serial.baudRate < 1
    ) {
      setPage("serial");
      setError("波特率必须是大于 0 的整数。");
      return;
    }
    if (connect && draft.protocol === "ssh" && !draft.ssh.host.trim()) {
      setPage("ssh");
      setError("请输入 SSH 主机地址。");
      return;
    }
    if (
      draft.protocol === "ssh" &&
      (!Number.isInteger(draft.ssh.port) ||
        draft.ssh.port < 1 ||
        draft.ssh.port > 65_535)
    ) {
      setPage("ssh");
      setError("SSH 端口必须是 1–65535 的整数。");
      return;
    }
    if (
      connect &&
      draft.protocol === "ssh" &&
      draft.ssh.authMode === "privateKey" &&
      !draft.ssh.privateKeyPath.trim()
    ) {
      setPage("ssh");
      setError("使用私钥认证时必须填写私钥路径。");
      return;
    }
    if (connect && draft.protocol === "adb" && !draft.adb.deviceId.trim()) {
      setPage("adb");
      setError("请输入或选择 ADB 设备 ID。");
      return;
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
      label: "串口",
      description: "创建或编辑一个本地串口连接",
      icon: Cable,
    },
    ssh: {
      label: "SSH",
      description: "通过本机 OpenSSH 客户端连接远程主机",
      icon: Network,
    },
    adb: {
      label: "ADB",
      description: "通过 Android Debug Bridge 打开设备 Shell",
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
      item.id === "logging",
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
                {protocolDetail.label} 会话设置
              </h2>
              <p>{protocolDetail.description}</p>
            </div>
          </div>
          <button className="icon-button" onClick={onCancel} title="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="dialog-content">
          <nav className="dialog-nav" aria-label="设置分类">
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
                  {item.label}
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
                    ? `${draft.ssh.host || "主机"}:${draft.ssh.port}`
                    : draft.adb.deviceId || "ADB 设备"}
              </span>
            </div>
          </nav>

          <main className="dialog-page">
            {page === "session" && (
              <>
                <div className="page-heading">
                  <h3>会话</h3>
                  <p>用于在会话树和标签栏中识别设备。</p>
                </div>
                <div className="form-grid">
                  <label className="field-row">
                    <span>协议</span>
                    <select
                      value={draft.protocol}
                      onChange={(event) => {
                        const protocol = event.target.value as SessionProtocol;
                        const names: Record<SessionProtocol, string> = {
                          serial: "新串口会话",
                          ssh: "新 SSH 会话",
                          adb: "新 ADB 会话",
                        };
                        const groups: Record<SessionProtocol, string> = {
                          serial: "串口会话",
                          ssh: "SSH 会话",
                          adb: "ADB 会话",
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
                                name: /^新.*会话$/.test(current.name)
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
                      <option value="serial">串口</option>
                      <option value="ssh">SSH</option>
                      <option value="adb">ADB Shell</option>
                    </select>
                  </label>
                  <label className="field-row">
                    <span>会话名称</span>
                    <input
                      autoFocus
                      value={draft.name}
                      onChange={(event) => update({ name: event.target.value })}
                    />
                  </label>
                  <label className="field-row">
                    <span>会话组</span>
                    <input
                      value={draft.group}
                      onChange={(event) => update({ group: event.target.value })}
                    />
                  </label>
                  <label className="field-row field-row-tall">
                    <span>描述</span>
                    <textarea
                      value={draft.description}
                      onChange={(event) =>
                        update({ description: event.target.value })
                      }
                      placeholder="可选，记录开发板、线缆或用途"
                    />
                  </label>
                  <label className="field-row">
                    <span>标签颜色</span>
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
                    <h3>串口</h3>
                    <p>设置端口和线路参数。</p>
                  </div>
                  <button className="secondary-button" onClick={onRefreshPorts}>
                    <RefreshCw size={15} />
                    刷新设备
                  </button>
                </div>
                <div className="form-grid">
                  <label className="field-row">
                    <span>串口</span>
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
                          (!draft.name || draft.name === "新串口会话")
                        ) {
                          update({ name: port.displayName });
                        }
                      }}
                    >
                      <option value="">选择一个串口设备…</option>
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
                          {selectedPort.manufacturer || "本地串口"}
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
                    <span>波特率</span>
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
                    <span>数据位</span>
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
                    <span>校验位</span>
                    <select
                      value={draft.serial.parity}
                      onChange={(event) =>
                        updateSerial({ parity: event.target.value as Parity })
                      }
                    >
                      <option value="none">None</option>
                      <option value="odd">Odd</option>
                      <option value="even">Even</option>
                      <option value="mark">Mark（平台相关）</option>
                      <option value="space">Space（平台相关）</option>
                    </select>
                  </label>
                  <label className="field-row">
                    <span>停止位</span>
                    <select
                      value={draft.serial.stopBits}
                      onChange={(event) =>
                        updateSerial({
                          stopBits: event.target.value as StopBits,
                        })
                      }
                    >
                      <option value="1">1</option>
                      <option value="1.5">1.5（平台相关）</option>
                      <option value="2">2</option>
                    </select>
                  </label>
                  <label className="field-row">
                    <span>流控制</span>
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
                    <span>打开时信号</span>
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
                    <span>设备恢复</span>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={draft.serial.autoReconnect}
                        onChange={(event) =>
                          updateSerial({ autoReconnect: event.target.checked })
                        }
                      />
                      设备重新出现后自动重连（最多 8 次）
                    </label>
                  </div>
                </div>
              </>
            )}

            {page === "ssh" && (
              <>
                <div className="page-heading">
                  <h3>SSH</h3>
                  <p>使用本机 OpenSSH、SSH Agent 或私钥连接远程主机。</p>
                </div>
                <div className="form-grid">
                  <label className="field-row">
                    <span>主机</span>
                    <input
                      value={draft.ssh.host}
                      onChange={(event) =>
                        updateSsh({ host: event.target.value })
                      }
                      placeholder="192.168.1.10 或 example.com"
                    />
                  </label>
                  <label className="field-row">
                    <span>端口</span>
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
                    <span>用户名</span>
                    <input
                      value={draft.ssh.username}
                      onChange={(event) =>
                        updateSsh({ username: event.target.value })
                      }
                      placeholder="留空时由 OpenSSH 决定"
                    />
                  </label>
                  <label className="field-row">
                    <span>认证方式</span>
                    <select
                      value={draft.ssh.authMode}
                      onChange={(event) =>
                        updateSsh({
                          authMode: event.target
                            .value as SessionProfile["ssh"]["authMode"],
                        })
                      }
                    >
                      <option value="agent">SSH Agent / 默认密钥</option>
                      <option value="privateKey">指定私钥</option>
                    </select>
                  </label>
                  {draft.ssh.authMode === "privateKey" && (
                    <label className="field-row">
                      <span>私钥路径</span>
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
                    <span>主机密钥</span>
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
                      严格校验 known_hosts（推荐）
                    </label>
                  </div>
                  <label className="field-row">
                    <span>保活间隔</span>
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
              </>
            )}

            {page === "adb" && (
              <>
                <div className="page-heading heading-with-action">
                  <div>
                    <h3>ADB Shell</h3>
                    <p>选择 USB、模拟器或网络连接的 Android 设备。</p>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={onRefreshAdbDevices}
                  >
                    <RefreshCw size={15} />
                    刷新设备
                  </button>
                </div>
                <div className="form-grid">
                  <label className="field-row">
                    <span>设备 ID</span>
                    <input
                      list="adb-device-ids"
                      value={draft.adb.deviceId}
                      onChange={(event) =>
                        updateAdb({ deviceId: event.target.value })
                      }
                      placeholder="emulator-5554 或 192.168.1.20:5555"
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
                                ? "已授权"
                                : device.state === "unauthorized"
                                  ? "等待设备授权"
                                  : device.state}
                            </span>
                          </div>
                        </div>
                      ) : null;
                    })()}
                  <label className="field-row">
                    <span>Shell 命令</span>
                    <input
                      value={draft.adb.shell}
                      onChange={(event) =>
                        updateAdb({ shell: event.target.value })
                      }
                      placeholder="留空使用设备默认 Shell"
                    />
                  </label>
                  <div className="settings-note">
                    <Smartphone size={17} />
                    需要系统已安装 Android Platform Tools，并且 adb 命令可执行。
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
                  <div className="settings-note">
                    <FileClock size={17} />
                    日志按“会话名_日期_时间.log”命名。原始模式逐字节保存，
                    文本模式按当前会话字符集增量解码。
                  </div>
                </div>
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
