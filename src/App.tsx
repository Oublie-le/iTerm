import {
  Binary,
  Cable,
  ChevronDown,
  CirclePlus,
  CircleStop,
  FileClock,
  Info,
  Link2,
  Menu,
  MessageSquareText,
  PanelBottom,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SenderPane } from "./components/SenderPane";
import { SessionDialog } from "./components/SessionDialog";
import { SessionSidebar } from "./components/SessionSidebar";
import { TerminalPane } from "./components/TerminalPane";
import {
  areSerialPortListsEqual,
  closeSerialSession,
  formatByteCount,
  listSerialPorts,
  openSerialSession,
  parseHex,
  sendSerialBreak,
  setSerialSignal,
  setSerialLogPaused,
  startSerialLog,
  stopSerialLog,
  writeSerialBytes,
  writeSerialText,
  writeSerialTextMany,
} from "./lib/serial";
import { appendReceiveChunk } from "./lib/receive";
import {
  createRuntimeSession,
  createSessionProfile,
  duplicateSessionProfile,
  normalizeSessionProfile,
  reconnectDelayMs,
  type RuntimeSession,
  type SenderPreset,
  type SerialEvent,
  type SerialPortDescriptor,
  type SessionProfile,
  type SyncChannel,
} from "./lib/types";
import {
  loadWorkspaceSnapshot,
  saveWorkspaceSnapshot,
} from "./lib/workspace";

const PROFILE_STORAGE_KEY = "iterm.profiles.v1";
const LEGACY_PROFILE_STORAGE_KEY = "serialterm.profiles.v1";
const MAX_RECONNECT_ATTEMPTS = 8;

function loadProfiles(): SessionProfile[] {
  try {
    const value =
      localStorage.getItem(PROFILE_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY);
    return value
      ? (JSON.parse(value) as SessionProfile[]).map(normalizeSessionProfile)
      : [];
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
  const [initialWorkspace] = useState(loadWorkspaceSnapshot);
  const [profiles, setProfiles] = useState<SessionProfile[]>(loadProfiles);
  const [ports, setPorts] = useState<SerialPortDescriptor[]>([]);
  const [sessions, setSessions] = useState<RuntimeSession[]>(() =>
    initialWorkspace.openProfileIds.flatMap((profileId) => {
      const profile = profiles.find((item) => item.id === profileId);
      if (!profile) return [];
      return [
        {
          ...createRuntimeSession(profile),
          notice: {
            tone: "info" as const,
            title: "会话已从上次工作区恢复，点击连接以打开串口。",
          },
        },
      ];
    }),
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    () =>
      sessions.find(
        (session) =>
          session.profileId === initialWorkspace.activeProfileId,
      )?.id ??
      sessions[0]?.id ??
      null,
  );
  const [sidebarOpen, setSidebarOpen] = useState(
    initialWorkspace.sidebarOpen,
  );
  const [senderOpen, setSenderOpen] = useState(initialWorkspace.senderOpen);
  const [focusMode, setFocusMode] = useState(false);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] =
    useState<SessionProfile | null>(null);
  const [sidebarFilter, setSidebarFilter] = useState("");
  const [portError, setPortError] = useState("");
  const [dtr, setDtr] = useState(true);
  const [rts, setRts] = useState(true);
  const refreshInFlightRef = useRef(false);

  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );
  const activeProfile = profiles.find(
    (profile) => profile.id === activeSession?.profileId,
  );

  const refreshPorts = useCallback(async (silent = false) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    if (!silent) setPortError("");
    try {
      const next = await listSerialPorts();
      setPorts((current) =>
        areSerialPortListsEqual(current, next) ? current : next,
      );
      setPortError("");
    } catch (error) {
      if (!silent) {
        setPortError(
          error instanceof Error ? error.message : "无法读取本机串口设备。",
        );
      }
    } finally {
      refreshInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refreshPorts();
    const timer = window.setInterval(() => void refreshPorts(true), 1_000);
    return () => window.clearInterval(timer);
  }, [refreshPorts]);

  useEffect(() => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
  }, [profiles]);

  useEffect(() => {
    saveWorkspaceSnapshot({
      sidebarOpen,
      senderOpen,
      openProfileIds: sessions.map((session) => session.profileId),
      activeProfileId:
        sessions.find((session) => session.id === activeSessionId)?.profileId ??
        null,
    });
  }, [activeSessionId, senderOpen, sessions, sidebarOpen]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLocaleLowerCase() === "f" &&
        event.ctrlKey &&
        event.shiftKey
      ) {
        event.preventDefault();
        setFocusMode((current) => !current);
      }
      if (event.key === "Escape" && focusMode) {
        setFocusMode(false);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [focusMode]);

  const applyEvent = useCallback((event: SerialEvent) => {
    setSessions((current) =>
      current.map((session) => {
        if (session.id !== event.sessionId) return session;
        switch (event.type) {
          case "state":
            return {
              ...session,
              state: event.state,
              reconnectAttempts:
                event.state === "connected" ? 0 : session.reconnectAttempts,
              nextReconnectAt:
                event.state === "connected"
                  ? undefined
                  : session.nextReconnectAt,
              logState:
                event.state === "disconnected" ||
                event.state === "deviceLost" ||
                event.state === "error"
                  ? "stopped"
                  : session.logState,
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
          case "error": {
            const reconnectAttempts = session.reconnectAttempts + 1;
            const willReconnect =
              event.recoverable &&
              reconnectAttempts <= MAX_RECONNECT_ATTEMPTS;
            return {
              ...session,
              state: willReconnect ? "deviceLost" : "error",
              reconnectAttempts,
              nextReconnectAt: willReconnect
                ? Date.now() +
                  reconnectDelayMs(reconnectAttempts)
                : undefined,
              notice: {
                tone: "error",
                title: event.message,
                detail: willReconnect
                  ? `${event.code} · 将自动尝试第 ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} 次重连`
                  : event.code,
              },
            };
          }
          case "log":
            return {
              ...session,
              logState: event.state,
              logPath: event.path ?? session.logPath,
              notice:
                event.state === "error"
                  ? {
                      tone: "error" as const,
                      title: "日志写入失败",
                      detail: event.message,
                    }
                  : session.notice,
            };
        }
      }),
    );
  }, []);

  const startLogging = useCallback(
    async (sessionId: string, profile: SessionProfile) => {
      try {
        const path = await startSerialLog(
          sessionId,
          profile.name,
          profile.logging.mode,
          profile.terminal.encoding,
          profile.logging.append,
        );
        setSessions((current) =>
          current.map((session) =>
            session.id === sessionId
              ? { ...session, logState: "recording", logPath: path }
              : session,
          ),
        );
      } catch (error) {
        setSessions((current) =>
          current.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  logState: "error",
                  notice: {
                    tone: "error",
                    title: "无法开始日志",
                    detail:
                      error instanceof Error ? error.message : String(error),
                  },
                }
              : session,
          ),
        );
      }
    },
    [],
  );

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
            if (profile.logging.autoStart) {
              await startLogging(alreadyOpen.id, profile);
            }
          } catch (error) {
            applyEvent({
              type: "error",
              sessionId: alreadyOpen.id,
              code: "OPEN_FAILED",
              message:
                error instanceof Error ? error.message : String(error),
              recoverable: profile.serial.autoReconnect,
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
            ...createRuntimeSession(profile, "opening"),
            id: sessionId,
          },
        ]);
      } else {
        await closeSerialSession(sessionId).catch(() => undefined);
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
        if (profile.logging.autoStart) {
          await startLogging(sessionId, profile);
        }
      } catch (error) {
        applyEvent({
          type: "error",
          sessionId,
          code: "OPEN_FAILED",
          message: error instanceof Error ? error.message : String(error),
          recoverable: profile.serial.autoReconnect,
        });
      }
    },
    [applyEvent, sessions, startLogging],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const session of sessions) {
        if (
          session.state !== "deviceLost" ||
          !session.nextReconnectAt ||
          session.nextReconnectAt > now
        ) {
          continue;
        }
        const profile = profiles.find(
          (item) => item.id === session.profileId,
        );
        if (
          profile?.serial.autoReconnect &&
          ports.some((port) => port.path === profile.serial.portPath)
        ) {
          void connectProfile(profile, session.id);
        }
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [connectProfile, ports, profiles, sessions]);

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
                logState: "stopped",
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
      const targets =
        runtime.syncChannel === "off"
          ? [runtime]
          : sessions.filter(
              (session) =>
                session.state === "connected" &&
                session.syncChannel === runtime.syncChannel,
            );
      const results = await writeSerialTextMany(
        targets.map((session) => session.id),
        value,
        profile.terminal.encoding,
      );
      const counts = new Map(
        results.map((result) => [result.sessionId, result.byteCount]),
      );
      setSessions((current) =>
        current.map((item) =>
          counts.has(item.id)
            ? {
                ...item,
                bytesWritten: item.bytesWritten + (counts.get(item.id) ?? 0),
              }
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

  const toggleLogPaused = async () => {
    if (!activeSession) return;
    const paused = activeSession.logState === "recording";
    try {
      await setSerialLogPaused(activeSession.id, paused);
      setSessions((current) =>
        current.map((session) =>
          session.id === activeSession.id
            ? { ...session, logState: paused ? "paused" : "recording" }
            : session,
        ),
      );
    } catch (error) {
      setSessions((current) =>
        current.map((session) =>
          session.id === activeSession.id
            ? {
                ...session,
                notice: {
                  tone: "error",
                  title: "无法更改日志状态",
                  detail: error instanceof Error ? error.message : String(error),
                },
              }
            : session,
        ),
      );
    }
  };

  const stopLogging = async () => {
    if (!activeSession) return;
    try {
      await stopSerialLog(activeSession.id);
      setSessions((current) =>
        current.map((session) =>
          session.id === activeSession.id
            ? { ...session, logState: "stopped" }
            : session,
        ),
      );
    } catch (error) {
      setSessions((current) =>
        current.map((session) =>
          session.id === activeSession.id
            ? {
                ...session,
                notice: {
                  tone: "error",
                  title: "无法停止日志",
                  detail: error instanceof Error ? error.message : String(error),
                },
              }
            : session,
        ),
      );
    }
  };

  const cycleSyncChannel = () => {
    if (!activeSession) return;
    const channels: SyncChannel[] = ["off", "A", "B", "C", "D"];
    const next =
      channels[
        (channels.indexOf(activeSession.syncChannel) + 1) % channels.length
      ];
    setSessions((current) =>
      current.map((session) =>
        session.id === activeSession.id
          ? { ...session, syncChannel: next }
          : session,
      ),
    );
  };

  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );

  return (
    <div className={`app-shell ${focusMode ? "is-focus-mode" : ""}`}>
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
          <button
            className={
              activeSession?.syncChannel !== "off" ? "is-active" : ""
            }
            title="切换同步输入通道 A/B/C/D"
            disabled={!activeSession}
            onClick={cycleSyncChannel}
          >
            <Link2 size={17} />
            同步{" "}
            {activeSession?.syncChannel === "off"
              ? "—"
              : activeSession?.syncChannel}
          </button>
          <button
            className={focusMode ? "is-active" : ""}
            title="专注模式（Ctrl+Shift+F）"
            onClick={() => setFocusMode((current) => !current)}
          >
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
              {activeSession?.logState === "recording" ||
              activeSession?.logState === "paused" ? (
                <>
                  <button
                    className={`signal-button ${
                      activeSession.logState === "recording" ? "is-active" : ""
                    }`}
                    onClick={() => void toggleLogPaused()}
                    title={
                      activeSession.logState === "recording"
                        ? "暂停日志"
                        : "继续日志"
                    }
                  >
                    {activeSession.logState === "recording" ? (
                      <Pause size={14} />
                    ) : (
                      <Play size={14} />
                    )}
                    LOG
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => void stopLogging()}
                    title="停止日志"
                  >
                    <CircleStop size={16} />
                  </button>
                </>
              ) : (
                <button
                  className="signal-button"
                  disabled={
                    !activeSession ||
                    !activeProfile ||
                    activeSession.state !== "connected"
                  }
                  onClick={() =>
                    activeSession &&
                    activeProfile &&
                    void startLogging(activeSession.id, activeProfile)
                  }
                  title="开始会话日志"
                >
                  <FileClock size={14} />
                  LOG
                </button>
              )}
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
              {activeSession?.logState !== "stopped" && (
                <span
                  className={`log-status state-${activeSession?.logState}`}
                  title={activeSession?.logPath}
                >
                  日志{" "}
                  {activeSession?.logState === "recording"
                    ? "记录中"
                    : activeSession?.logState === "paused"
                      ? "已暂停"
                      : "错误"}
                </span>
              )}
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
      {focusMode && (
        <button
          className="focus-exit-button"
          onClick={() => setFocusMode(false)}
          title="退出专注模式（Esc）"
        >
          <Zap size={15} />
          退出专注
        </button>
      )}
    </div>
  );
}
