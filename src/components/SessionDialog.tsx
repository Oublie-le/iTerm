import {
  Cable,
  FileClock,
  Info,
  Monitor,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  TerminalSquare,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  FlowControl,
  Parity,
  SerialPortDescriptor,
  SessionProfile,
  StopBits,
} from "../lib/types";

type DialogPage = "session" | "serial" | "terminal" | "window" | "logging";

interface SessionDialogProps {
  open: boolean;
  profile: SessionProfile | null;
  ports: SerialPortDescriptor[];
  onCancel: () => void;
  onRefreshPorts: () => void;
  onSave: (profile: SessionProfile, connect: boolean) => void;
}

const pages: Array<{
  id: DialogPage;
  label: string;
  icon: typeof Info;
}> = [
  { id: "session", label: "会话", icon: Info },
  { id: "serial", label: "串口", icon: Cable },
  { id: "terminal", label: "终端", icon: TerminalSquare },
  { id: "window", label: "窗口", icon: Monitor },
  { id: "logging", label: "日志", icon: FileClock },
];

export function SessionDialog({
  open,
  profile,
  ports,
  onCancel,
  onRefreshPorts,
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

  const updateTerminal = (patch: Partial<SessionProfile["terminal"]>) =>
    setDraft((current) =>
      current
        ? { ...current, terminal: { ...current.terminal, ...patch } }
        : current,
    );

  const submit = (connect: boolean) => {
    if (!draft.name.trim()) {
      setPage("session");
      setError("请输入会话名称。");
      return;
    }
    if (connect && !draft.serial.portPath) {
      setPage("serial");
      setError("请选择串口设备。");
      return;
    }
    if (
      !Number.isInteger(draft.serial.baudRate) ||
      draft.serial.baudRate < 1
    ) {
      setPage("serial");
      setError("波特率必须是大于 0 的整数。");
      return;
    }
    onSave(
      { ...draft, updatedAt: new Date().toISOString() },
      connect,
    );
  };

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
              <Cable size={20} />
            </span>
            <div>
              <h2 id="session-dialog-title">串口会话设置</h2>
              <p>创建或编辑一个本地串口连接</p>
            </div>
          </div>
          <button className="icon-button" onClick={onCancel} title="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="dialog-content">
          <nav className="dialog-nav" aria-label="设置分类">
            {pages.map((item) => {
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
                {draft.serial.baudRate}/{draft.serial.dataBits}/
                {draft.serial.parity === "none"
                  ? "N"
                  : draft.serial.parity[0].toUpperCase()}
                /{draft.serial.stopBits}
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
                    <div className="protocol-field">
                      <Cable size={16} />
                      串口
                    </div>
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
                        updateSerial({ portPath: event.target.value });
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
                  <p>首个纵向切片暂提供运行时日志，完整日志策略将在 M4 接入。</p>
                </div>
                <div className="coming-soon-card">
                  <FileClock size={24} />
                  <div>
                    <strong>会话日志将在下一里程碑启用</strong>
                    <span>
                      已预留原始字节、可打印文本、覆盖/追加、文件模板和滚动接口。
                    </span>
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
