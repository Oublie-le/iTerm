import {
  Binary,
  Cable,
  ChevronDown,
  CirclePlus,
  CircleStop,
  Info,
  Link2,
  Menu,
  MessageSquareText,
  PanelBottom,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  RefreshCw,
  RotateCw,
  Search,
  Send,
  Settings,
  Unplug,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SenderPane } from "./components/SenderPane";
import { SessionDialog } from "./components/SessionDialog";
import { SessionSidebar } from "./components/SessionSidebar";
import { TerminalPane } from "./components/TerminalPane";
import {
  closeSerialSession,
  formatByteCount,
  listSerialPorts,
  openSerialSession,
  parseHex,
  sendSerialBreak,
  setSerialSignal,
  writeSerialBytes,
  writeSerialText,
} from "./lib/serial";
import { appendReceiveChunk } from "./lib/receive";
import {
  createSessionProfile,
  duplicateSessionProfile,
  type RuntimeSession,
  type SenderPreset,
  type SerialEvent,
  type SerialPortDescriptor,
  type SessionProfile,
} from "./lib/types";

const PROFILE_STORAGE_KEY = "iterm.profiles.v1";
const LEGACY_PROFILE_STORAGE_KEY = "serialterm.profiles.v1";

function loadProfiles(): SessionProfile[] {
  try {
    const value =
      localStorage.getItem(PROFILE_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY);
    return value ? (JSON.parse(value) as SessionProfile[]) : [];
  } catch {
    return [];
  }
}

function stateLabel(state: RuntimeSession["state"]): string {
  const labels: Record<RuntimeSession["state"], string> = {
    disconnected: "已断开",
    opening: "正在连接",
    connected: "已连接",
    closing: "正在关闭",
    deviceLost: "设备丢失",
    error: "连接错误",
  };
  return labels[state];
}

export default function App() {
  const [profiles, setProfiles] = useState<SessionProfile[]>(loadProfiles);
  const [ports, setPorts] = useState<SerialPortDescriptor[]>([]);
  const [sessions, setSessions] = useState<RuntimeSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [senderOpen, setSenderOpen] = useState(true);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] =
    useState<SessionProfile | null>(null);
  const [sidebarFilter, setSidebarFilter] = useState("");
  const [portError, setPortError] = useState("");
  const [dtr, setDtr] = useState(true);
  const [rts, setRts] = useState(true);

  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );
  const activeProfile = profiles.find(
    (profile) => profile.id === activeSession?.profileId,
  );

  const refreshPorts = useCallback(async () => {
    setPortError("");
    try {
      setPorts(await listSerialPorts());
    } catch (error) {
      setPortError(
        error instanceof Error ? error.message : "无法读取本机串口设备。",
      );
    }
  }, []);

  useEffect(() => {
    void refreshPorts();
  }, [refreshPorts]);

  useEffect(() => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
  }, [profiles]);

  const applyEvent = useCallback((event: SerialEvent) => {
    setSessions((current) =>
      current.map((session) => {
        if (session.id !== event.sessionId) return session;
        switch (event.type) {
          case "state":
            return {
              ...session,
              state: event.state,
              notice:
                event.state === "connected"
                  ? undefined
                  : event.message
                    ? {
                        tone:
                          event.state === "error" ||
                          event.state === "deviceLost"
                            ? ("error" as const)
                            : ("info" as const),
                        title: event.message,
                      }
                    : session.notice,
            };
          case "data": {
            const chunk = {
              nonce: performance.now(),
              sequence: event.sequence,
              receivedAtMs: event.receivedAtMs,
              bytes: event.bytes,
            };
            return {
              ...session,
              sequence: event.sequence,
              receiveChunks: appendReceiveChunk(session.receiveChunks, chunk),
              lastChunk: chunk,
              bytesRead: session.bytesRead + event.bytes.length,
            };
          }
          case "writeComplete":
            return {
              ...session,
              bytesWritten: session.bytesWritten + event.byteCount,
            };
          case "error":
            return {
              ...session,
              state: event.recoverable ? "deviceLost" : "error",
              notice: {
                tone: "error",
                title: event.message,
                detail: event.code,
              },
            };
        }
      }),
    );
  }, []);

  const connectProfile = useCallback(
    async (profile: SessionProfile, existingId?: string) => {
      if (!profile.serial.portPath) {
        setEditingProfile(profile);
        setSessionDialogOpen(true);
        return;
      }

      const alreadyOpen = sessions.find(
        (session) => session.profileId === profile.id,
      );
      if (alreadyOpen && !existingId) {
        setActiveSessionId(alreadyOpen.id);
        if (
          alreadyOpen.state === "disconnected" ||
          alreadyOpen.state === "error" ||
          alreadyOpen.state === "deviceLost"
        ) {
          await closeSerialSession(alreadyOpen.id).catch(() => undefined);
          setSessions((current) =>
            current.map((item) =>
              item.id === alreadyOpen.id
                ? { ...item, state: "opening", notice: undefined }
                : item,
            ),
          );
          try {
            await openSerialSession(alreadyOpen.id, profile, applyEvent);
          } catch (error) {
            applyEvent({
              type: "error",
              sessionId: alreadyOpen.id,
              code: "OPEN_FAILED",
              message:
                error instanceof Error ? error.message : String(error),
              recoverable: false,
            });
          }
        }
        return;
      }

      const sessionId = existingId ?? crypto.randomUUID();
      if (!existingId) {
        setSessions((current) => [
          ...current,
          {
            id: sessionId,
            profileId: profile.id,
            title: profile.name,
            state: "opening",
            sequence: 0,
            receiveMode: "text",
            receiveChunks: [],
            receiveBaseOffset: 0,
            bytesRead: 0,
            bytesWritten: 0,
            terminalCols: 80,
            terminalRows: 24,
            openedAt: Date.now(),
          },
        ]);
      } else {
        setSessions((current) =>
          current.map((session) =>
            session.id === sessionId
              ? { ...session, state: "opening", notice: undefined }
              : session,
          ),
        );
      }
      setActiveSessionId(sessionId);
      setDtr(profile.serial.dtrOnOpen);
      setRts(profile.serial.rtsOnOpen);

      try {
        await openSerialSession(sessionId, profile, applyEvent);
      } catch (error) {
        applyEvent({
          type: "error",
          sessionId,
          code: "OPEN_FAILED",
          message: error instanceof Error ? error.message : String(error),
          recoverable: false,
        });
      }
    },
    [applyEvent, sessions],
  );

  const disconnectSession = async (session: RuntimeSession) => {
    setSessions((current) =>
      current.map((item) =>
        item.id === session.id ? { ...item, state: "closing" } : item,
      ),
    );
    try {
      await closeSerialSession(session.id);
      setSessions((current) =>
        current.map((item) =>
          item.id === session.id
            ? {
                ...item,
                state: "disconnected",
                notice: {
                  tone: "info",
                  title: "会话已断开，点击重连可再次打开串口。",
                },
              }
            : item,
        ),
      );
    } catch (error) {
      applyEvent({
        type: "error",
        sessionId: session.id,
        code: "CLOSE_FAILED",
        message: error instanceof Error ? error.message : String(error),
        recoverable: false,
      });
    }
  };

  const closeTab = async (sessionId: string) => {
    await closeSerialSession(sessionId).catch(() => undefined);
    setSessions((current) => current.filter((item) => item.id !== sessionId));
    setActiveSessionId((current) => {
      if (current !== sessionId) return current;
      const remaining = sessions.filter((item) => item.id !== sessionId);
      return remaining.at(-1)?.id ?? null;
    });
  };

  const openNewDialog = () => {
    setEditingProfile(createSessionProfile(ports[0]));
    setSessionDialogOpen(true);
  };

  const saveProfile = (profile: SessionProfile, connect: boolean) => {
    setProfiles((current) => {
      const exists = current.some((item) => item.id === profile.id);
      return exists
        ? current.map((item) => (item.id === profile.id ? profile : item))
        : [...current, profile];
    });
    setSessionDialogOpen(false);
    setEditingProfile(null);
    if (connect) {
      window.setTimeout(() => void connectProfile(profile), 0);
    }
  };

  const duplicateProfile = (profile: SessionProfile) => {
    const duplicate = duplicateSessionProfile(profile);
    setProfiles((current) => [...current, duplicate]);
    setEditingProfile(duplicate);
    setSessionDialogOpen(true);
  };

  const deleteProfile = async (profile: SessionProfile) => {
    const runtime = sessions.find(
      (session) => session.profileId === profile.id,
    );
    if (!window.confirm(`确定删除会话“${profile.name}”吗？此操作无法撤销。`)) {
      return;
    }
    if (runtime) {
      await closeSerialSession(runtime.id).catch(() => undefined);
      const remaining = sessions.filter((session) => session.id !== runtime.id);
      setSessions(remaining);
      setActiveSessionId((current) =>
        current === runtime.id ? (remaining.at(-1)?.id ?? null) : current,
      );
    }
    setProfiles((current) => current.filter((item) => item.id !== profile.id));
  };

  const writeTerminalInput = async (
    runtime: RuntimeSession,
    profile: SessionProfile,
    value: string,
  ) => {
    if (runtime.state !== "connected") return;
    try {
      const count = await writeSerialText(
        runtime.id,
        value,
        profile.terminal.encoding,
      );
      setSessions((current) =>
        current.map((item) =>
          item.id === runtime.id
            ? { ...item, bytesWritten: item.bytesWritten + count }
            : item,
        ),
      );
    } catch (error) {
      applyEvent({
        type: "error",
        sessionId: runtime.id,
        code: "WRITE_FAILED",
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
      });
    }
  };

  const sendPreset = async (preset: SenderPreset): Promise<number> => {
    if (!activeSession || !activeProfile) {
      throw new Error("没有活动会话。");
    }
    if (activeSession.state !== "connected") {
      throw new Error("串口未连接。");
    }
    const count =
      preset.mode === "hex"
        ? await writeSerialBytes(activeSession.id, parseHex(preset.payload))
        : await writeSerialText(
            activeSession.id,
            preset.payload,
            activeProfile.terminal.encoding,
            preset.lineEnding,
          );
    setSessions((current) =>
      current.map((item) =>
        item.id === activeSession.id
          ? { ...item, bytesWritten: item.bytesWritten + count }
          : item,
      ),
    );
    return count;
  };

  const toggleSignal = async (signal: "dtr" | "rts") => {
    if (!activeSession || activeSession.state !== "connected") return;
    const next = signal === "dtr" ? !dtr : !rts;
    await setSerialSignal(activeSession.id, signal, next);
    if (signal === "dtr") setDtr(next);
    else setRts(next);
  };

  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );

  return (
    <div className="app-shell">
      <header className="app-menubar">
        <div className="menu-items">
          {["会话", "编辑", "搜索", "选择", "转到", "查看", "模式", "工具", "窗口", "帮助"].map(
            (item) => (
              <button key={item}>{item}</button>
            ),
          )}
        </div>
        <div className="menu-actions">
          <button title="搜索">
            <Search size={17} />
          </button>
          <button title="同步输入通道">
            <Link2 size={17} />
            隧道
          </button>
          <button title="专注模式">
            <Zap size={16} />
            专注模式
          </button>
          <button title="更多">
            <Menu size={18} />
          </button>
        </div>
      </header>

      <div className="workspace">
        {sidebarOpen && (
          <SessionSidebar
            profiles={profiles}
            ports={ports}
            sessions={sessions}
            filter={sidebarFilter}
            onFilterChange={setSidebarFilter}
            onNew={openNewDialog}
            onOpen={(profile) => void connectProfile(profile)}
            onEdit={(profile) => {
              setEditingProfile(profile);
              setSessionDialogOpen(true);
            }}
            onDuplicate={duplicateProfile}
            onDelete={(profile) => void deleteProfile(profile)}
            onRefresh={() => void refreshPorts()}
          />
        )}

        <main className="main-area">
          <div className="tab-strip">
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarOpen((value) => !value)}
              title={sidebarOpen ? "隐藏会话管理器" : "显示会话管理器"}
            >
              {sidebarOpen ? (
                <PanelLeftClose size={17} />
              ) : (
                <PanelLeftOpen size={17} />
              )}
            </button>
            <div className="tabs">
              {sessions.map((session, index) => (
                <button
                  key={session.id}
                  className={`session-tab ${
                    session.id === activeSessionId ? "is-active" : ""
                  }`}
                  onClick={() => setActiveSessionId(session.id)}
                >
                  <span
                    className={`tab-state state-${session.state}`}
                    style={{
                      background:
                        profileById.get(session.profileId)?.color ?? "#17a34a",
                    }}
                  />
                  <span className="tab-title">
                    {index + 1}. {session.title}
                  </span>
                  <span
                    className="tab-close"
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      void closeTab(session.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void closeTab(session.id);
                    }}
                  >
                    <X size={15} />
                  </span>
                </button>
              ))}
            </div>
            <button className="tab-action" onClick={openNewDialog} title="新建会话">
              <CirclePlus size={18} />
            </button>
            <button className="tab-action" title="标签列表">
              <Menu size={17} />
            </button>
          </div>

          <div className="session-toolbar">
            <div className="toolbar-group">
              <button className="icon-button" onClick={openNewDialog} title="新建会话">
                <CirclePlus size={19} />
              </button>
              {activeSession?.state === "connected" ? (
                <button
                  className="icon-button"
                  onClick={() => void disconnectSession(activeSession)}
                  title="断开会话"
                >
                  <Unplug size={18} />
                </button>
              ) : (
                <button
                  className="icon-button"
                  disabled={!activeProfile}
                  onClick={() =>
                    activeProfile && void connectProfile(activeProfile)
                  }
                  title="连接会话"
                >
                  <PlugZap size={18} />
                </button>
              )}
              <button
                className="icon-button"
                disabled={!activeProfile || activeSession?.state === "opening"}
                onClick={() =>
                  activeProfile &&
                  void connectProfile(activeProfile, activeSession?.id)
                }
                title="重新连接"
              >
                <RotateCw size={18} />
              </button>
              <button
                className="icon-button"
                disabled={!activeProfile}
                onClick={() => {
                  if (!activeProfile) return;
                  setEditingProfile(activeProfile);
                  setSessionDialogOpen(true);
                }}
                title="会话设置"
              >
                <Settings size={18} />
              </button>
            </div>

            <div className="session-breadcrumb">
              <Info size={17} />
              <span className="breadcrumb-divider" />
              <ChevronDown size={13} />
              <strong>serial</strong>
              <ChevronDown size={13} />
              <span>
                {activeProfile?.serial.portPath || "尚未打开串口会话"}
              </span>
            </div>

            <div className="toolbar-group toolbar-right">
              <button
                className={`signal-button ${
                  activeSession?.receiveMode === "hex" ? "is-active" : ""
                }`}
                disabled={!activeSession}
                onClick={() =>
                  setSessions((current) =>
                    current.map((session) =>
                      session.id === activeSession?.id
                        ? {
                            ...session,
                            receiveMode:
                              session.receiveMode === "text" ? "hex" : "text",
                          }
                        : session,
                    ),
                  )
                }
                title="切换文本与 Hex 接收视图"
              >
                <Binary size={15} />
                HEX
              </button>
              <button
                className={`signal-button ${dtr ? "is-active" : ""}`}
                disabled={activeSession?.state !== "connected"}
                onClick={() => void toggleSignal("dtr")}
                title="切换 DTR"
              >
                DTR
              </button>
              <button
                className={`signal-button ${rts ? "is-active" : ""}`}
                disabled={activeSession?.state !== "connected"}
                onClick={() => void toggleSignal("rts")}
                title="切换 RTS"
              >
                RTS
              </button>
              <button
                className="icon-button"
                disabled={activeSession?.state !== "connected"}
                onClick={() =>
                  activeSession && void sendSerialBreak(activeSession.id)
                }
                title="发送 Break"
              >
                <CircleStop size={18} />
              </button>
              <button
                className="icon-button"
                onClick={() => void refreshPorts()}
                title="刷新设备"
              >
                <RefreshCw size={18} />
              </button>
            </div>
          </div>

          {portError && (
            <div className="notice-bar error">
              <Info size={18} />
              <div>
                <strong>读取串口列表失败</strong>
                <span>{portError}</span>
              </div>
              <button onClick={() => setPortError("")}>
                <X size={17} />
              </button>
            </div>
          )}

          {activeSession?.notice && (
            <div className={`notice-bar ${activeSession.notice.tone}`}>
              <Info size={18} />
              <div>
                <strong>{activeSession.notice.title}</strong>
                {activeSession.notice.detail && (
                  <span>{activeSession.notice.detail}</span>
                )}
              </div>
              {(activeSession.state === "disconnected" ||
                activeSession.state === "error" ||
                activeSession.state === "deviceLost") &&
                activeProfile && (
                  <button
                    className="notice-action"
                    onClick={() =>
                      void connectProfile(activeProfile, activeSession.id)
                    }
                  >
                    重新连接
                  </button>
                )}
              <button
                onClick={() =>
                  setSessions((current) =>
                    current.map((session) =>
                      session.id === activeSession.id
                        ? { ...session, notice: undefined }
                        : session,
                    ),
                  )
                }
              >
                <X size={17} />
              </button>
            </div>
          )}

          <div className="terminal-stack">
            {sessions.length === 0 && (
              <div className="welcome-panel">
                <div className="welcome-mark">
                  <Cable size={34} />
                </div>
                <h1>iTerm</h1>
                <p>WindTerm 风格的跨平台串口工作区</p>
                <div className="welcome-actions">
                  <button className="primary-button" onClick={openNewDialog}>
                    <CirclePlus size={17} />
                    新建串口会话
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void refreshPorts()}
                  >
                    <RefreshCw size={16} />
                    刷新设备
                  </button>
                </div>
                <div className="available-port-summary">
                  <Cable size={15} />
                  {ports.length
                    ? `已发现 ${ports.length} 个串口设备`
                    : "暂未发现串口设备"}
                </div>
              </div>
            )}
            {sessions.map((session) => {
              const profile = profileById.get(session.profileId);
              if (!profile) return null;
              return (
                <TerminalPane
                  key={session.id}
                  session={session}
                  profile={profile}
                  active={session.id === activeSessionId}
                  receiveMode={session.receiveMode}
                  onResize={(cols, rows) =>
                    setSessions((current) =>
                      current.map((item) =>
                        item.id === session.id &&
                        (item.terminalCols !== cols || item.terminalRows !== rows)
                          ? { ...item, terminalCols: cols, terminalRows: rows }
                          : item,
                      ),
                    )
                  }
                  onClear={() =>
                    setSessions((current) =>
                      current.map((item) =>
                        item.id === session.id
                          ? {
                              ...item,
                              receiveChunks: [],
                              receiveBaseOffset: item.bytesRead,
                              lastChunk: undefined,
                            }
                          : item,
                      ),
                    )
                  }
                  onInput={(value) =>
                    void writeTerminalInput(session, profile, value)
                  }
                />
              );
            })}
          </div>

          {senderOpen && sessions.length > 0 && (
            <SenderPane
              connected={activeSession?.state === "connected"}
              onClose={() => setSenderOpen(false)}
              onSend={sendPreset}
            />
          )}

          <footer className="statusbar">
            <div>
              <span className="status-logo">
                <Cable size={15} />
              </span>
              <strong>
                {activeSession ? stateLabel(activeSession.state) : "就绪"}
              </strong>
            </div>
            <div className="status-items">
              <button>
                {activeSession?.state === "connected" ? "远程模式" : "本地模式"}
              </button>
              <span>
                窗口 {activeSession?.terminalCols ?? 80}×
                {activeSession?.terminalRows ?? 24}
              </span>
              <span>行 1</span>
              <span>字符 0</span>
              <span>{activeProfile?.terminal.termType ?? "Plain Text"}</span>
              <span>
                RX {formatByteCount(activeSession?.bytesRead ?? 0)} · TX{" "}
                {formatByteCount(activeSession?.bytesWritten ?? 0)}
              </span>
              <button
                className={senderOpen ? "is-active" : ""}
                onClick={() => setSenderOpen((value) => !value)}
                disabled={sessions.length === 0}
              >
                <PanelBottom size={15} />
                发送
              </button>
            </div>
          </footer>
        </main>
      </div>

      <SessionDialog
        open={sessionDialogOpen}
        profile={editingProfile}
        ports={ports}
        onCancel={() => {
          setSessionDialogOpen(false);
          setEditingProfile(null);
        }}
        onRefreshPorts={() => void refreshPorts()}
        onSave={saveProfile}
      />
    </div>
  );
}
