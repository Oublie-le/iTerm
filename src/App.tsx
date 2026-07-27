import {
  Binary,
  Cable,
  ChevronDown,
  CirclePlus,
  CircleStop,
  Columns2,
  Eraser,
  FileClock,
  FileText,
  FolderOpen,
  Info,
  Keyboard,
  Link2,
  Menu,
  MessageSquareText,
  PanelBottom,
  PanelLeftClose,
  PanelLeftOpen,
  PanelTopClose,
  Pause,
  Play,
  PlugZap,
  RefreshCw,
  RotateCw,
  Rows2,
  Search,
  Send,
  Settings,
  SunMoon,
  Unplug,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SenderPane } from "./components/SenderPane";
import { AppSettingsDialog } from "./components/AppSettingsDialog";
import { SessionDialog } from "./components/SessionDialog";
import { SessionSidebar } from "./components/SessionSidebar";
import { TerminalPane } from "./components/TerminalPane";
import {
  areSerialPortListsEqual,
  clearSerialBuffers,
  closeSerialSession,
  formatByteCount,
  findMatchingSerialPort,
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
} from "./lib/serial";
import {
  closeProcessSession,
  listAdbDevices,
  listExternalTools,
  openAdbSession,
  openSshSession,
  resizeProcessSession,
  setProcessLogPaused,
  startProcessLog,
  stopProcessLog,
  writeProcessBytes,
  writeProcessText,
} from "./lib/remote";
import { appendReceiveChunk } from "./lib/receive";
import { sendFileInChunks } from "./lib/fileTransfer";
import { openLogDirectory, openLogFile } from "./lib/logging";
import {
  createRuntimeSession,
  duplicateSessionProfile,
  normalizeSessionProfile,
  reconnectDelayMs,
  requiresCloseConfirmation,
  sessionTargetLabel,
  type RuntimeSession,
  type AdbDeviceDescriptor,
  type ExternalToolStatus,
  type FileTransferProtocol,
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
import {
  createSessionProfileWithPreferences,
  loadAppPreferences,
  nextThemeMode,
  resolveTheme,
  saveAppPreferences,
} from "./lib/preferences";
import {
  isEditableShortcutTarget,
  resolveShortcut,
} from "./lib/shortcuts";
import { SessionTriggerEvaluator } from "./lib/triggers";
import {
  createSplitSessionIds,
  selectSplitSession,
  type SplitMode,
  type SplitSessionIds,
} from "./lib/layout";
import { AsyncByteQueue, sendXmodemCrc } from "./lib/xmodem";
import { sendYmodemBatch } from "./lib/ymodem";

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

function hasConnectionTarget(profile: SessionProfile): boolean {
  if (profile.protocol === "ssh") return Boolean(profile.ssh.host.trim());
  if (profile.protocol === "adb") return Boolean(profile.adb.deviceId.trim());
  return Boolean(profile.serial.portPath);
}

async function openConfiguredSession(
  sessionId: string,
  profile: SessionProfile,
  onEvent: (event: SerialEvent) => void,
): Promise<void> {
  if (profile.protocol === "ssh") {
    return openSshSession(sessionId, profile, onEvent);
  }
  if (profile.protocol === "adb") {
    return openAdbSession(sessionId, profile, onEvent);
  }
  return openSerialSession(sessionId, profile, onEvent);
}

async function closeConfiguredSession(
  sessionId: string,
  profile?: SessionProfile,
): Promise<void> {
  if (profile?.protocol === "ssh" || profile?.protocol === "adb") {
    return closeProcessSession(sessionId);
  }
  return closeSerialSession(sessionId);
}

async function writeConfiguredText(
  sessionId: string,
  profile: SessionProfile,
  text: string,
  lineEnding: SenderPreset["lineEnding"] = "none",
): Promise<number> {
  if (profile.protocol === "ssh" || profile.protocol === "adb") {
    return writeProcessText(sessionId, text, lineEnding);
  }
  return writeSerialText(
    sessionId,
    text,
    profile.terminal.encoding,
    lineEnding,
  );
}

async function writeConfiguredBytes(
  sessionId: string,
  profile: SessionProfile,
  bytes: Uint8Array,
): Promise<number> {
  return profile.protocol === "serial"
    ? writeSerialBytes(sessionId, bytes)
    : writeProcessBytes(sessionId, bytes);
}

export default function App() {
  const [initialWorkspace] = useState(loadWorkspaceSnapshot);
  const [preferences, setPreferences] = useState(loadAppPreferences);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  const [profiles, setProfiles] = useState<SessionProfile[]>(loadProfiles);
  const [ports, setPorts] = useState<SerialPortDescriptor[]>([]);
  const [adbDevices, setAdbDevices] = useState<AdbDeviceDescriptor[]>([]);
  const [externalTools, setExternalTools] = useState<ExternalToolStatus[]>([]);
  const [sessions, setSessions] = useState<RuntimeSession[]>(() =>
    initialWorkspace.openProfileIds.flatMap((profileId) => {
      const profile = profiles.find((item) => item.id === profileId);
      if (!profile) return [];
      return [
        {
          ...createRuntimeSession(profile),
          notice: {
            tone: "info" as const,
            title: "会话已从上次工作区恢复，点击连接以建立连接。",
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
  const [splitSessionIds, setSplitSessionIds] =
    useState<SplitSessionIds | null>(() => {
      const restored = initialWorkspace.splitProfileIds?.flatMap((profileId) => {
        const session = sessions.find((item) => item.profileId === profileId);
        return session ? [session.id] : [];
      });
      return restored?.length === 2
        ? [restored[0], restored[1]]
        : null;
    });
  const [splitMode, setSplitMode] = useState<SplitMode>(() =>
    splitSessionIds ? initialWorkspace.splitMode : "single",
  );
  const [sidebarOpen, setSidebarOpen] = useState(
    initialWorkspace.sidebarOpen,
  );
  const [senderOpen, setSenderOpen] = useState(initialWorkspace.senderOpen);
  const [focusMode, setFocusMode] = useState(false);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [editingProfile, setEditingProfile] =
    useState<SessionProfile | null>(null);
  const [sidebarFilter, setSidebarFilter] = useState("");
  const [portError, setPortError] = useState("");
  const [adbError, setAdbError] = useState("");
  const [utilityError, setUtilityError] = useState("");
  const [dtr, setDtr] = useState(true);
  const [rts, setRts] = useState(true);
  const refreshInFlightRef = useRef(false);
  const triggerEvaluatorsRef = useRef(
    new Map<
      string,
      { encoding: string; evaluator: SessionTriggerEvaluator }
    >(),
  );
  const processedTriggerChunksRef = useRef(new Map<string, number>());
  const startingTriggerLogsRef = useRef(new Set<string>());
  const transferByteQueuesRef = useRef(new Map<string, AsyncByteQueue>());

  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );
  const activeProfile = profiles.find(
    (profile) => profile.id === activeSession?.profileId,
  );
  const resolvedTheme = resolveTheme(preferences.theme, systemPrefersDark);

  const activateSession = useCallback(
    (sessionId: string) => {
      setSplitSessionIds((current) =>
        current
          ? selectSplitSession(current, activeSessionId, sessionId)
          : current,
      );
      setActiveSessionId(sessionId);
    },
    [activeSessionId],
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

  const refreshAdbDevices = useCallback(async (silent = false) => {
    if (!silent) setAdbError("");
    try {
      setAdbDevices(await listAdbDevices());
      setAdbError("");
    } catch (error) {
      setAdbDevices([]);
      if (!silent) {
        setAdbError(
          error instanceof Error ? error.message : "无法读取 ADB 设备。",
        );
      }
    }
  }, []);

  const refreshExternalTools = useCallback(async () => {
    setExternalTools(await listExternalTools());
  }, []);

  useEffect(() => {
    void refreshPorts();
    const timer = window.setInterval(() => void refreshPorts(true), 1_000);
    return () => window.clearInterval(timer);
  }, [refreshPorts]);

  useEffect(() => {
    void refreshAdbDevices(true);
    const timer = window.setInterval(
      () => void refreshAdbDevices(true),
      3_000,
    );
    return () => window.clearInterval(timer);
  }, [refreshAdbDevices]);

  useEffect(() => {
    void refreshExternalTools();
  }, [refreshExternalTools]);

  useEffect(() => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
  }, [profiles]);

  useEffect(() => {
    saveAppPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mediaQuery) return;
    const handleChange = (event: MediaQueryListEvent) =>
      setSystemPrefersDark(event.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (ports.length === 0) return;
    setProfiles((current) =>
      current.map((profile) => {
        if (profile.protocol !== "serial") return profile;
        const match = findMatchingSerialPort(profile.serial, ports);
        if (!match || match.path === profile.serial.portPath) return profile;
        return {
          ...profile,
          serial: { ...profile.serial, portPath: match.path },
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  }, [ports]);

  useEffect(() => {
    const splitProfileIds = splitSessionIds?.flatMap((sessionId) => {
      const session = sessions.find((item) => item.id === sessionId);
      return session ? [session.profileId] : [];
    });
    saveWorkspaceSnapshot({
      sidebarOpen,
      senderOpen,
      openProfileIds: sessions.map((session) => session.profileId),
      activeProfileId:
        sessions.find((session) => session.id === activeSessionId)?.profileId ??
        null,
      splitMode,
      splitProfileIds:
        splitProfileIds?.length === 2
          ? [splitProfileIds[0], splitProfileIds[1]]
          : null,
    });
  }, [
    activeSessionId,
    senderOpen,
    sessions,
    sidebarOpen,
    splitMode,
    splitSessionIds,
  ]);

  useEffect(() => {
    if (splitMode === "single" || !splitSessionIds) return;
    const availableSessionIds = sessions.map((session) => session.id);
    if (
      splitSessionIds.every((sessionId) =>
        availableSessionIds.includes(sessionId),
      )
    ) {
      return;
    }
    const replacement = createSplitSessionIds(
      availableSessionIds,
      activeSessionId,
    );
    if (!replacement) {
      setSplitMode("single");
      setSplitSessionIds(null);
      return;
    }
    setSplitSessionIds(replacement);
    if (!replacement.includes(activeSessionId ?? "")) {
      setActiveSessionId(replacement[0]);
    }
  }, [activeSessionId, sessions, splitMode, splitSessionIds]);

  useEffect(() => {
    const confirmWindowClose = (event: BeforeUnloadEvent) => {
      if (!preferences.confirmActiveSessionClose) return;
      if (!sessions.some(requiresCloseConfirmation)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", confirmWindowClose);
    return () => window.removeEventListener("beforeunload", confirmWindowClose);
  }, [preferences.confirmActiveSessionClose, sessions]);

  const applyEvent = useCallback((event: SerialEvent) => {
    setSessions((current) =>
      current.map((session) => {
        if (session.id !== event.sessionId) return session;
        switch (event.type) {
          case "state":
            if (
              event.state === "disconnected" ||
              event.state === "deviceLost" ||
              event.state === "error"
            ) {
              transferByteQueuesRef.current
                .get(event.sessionId)
                ?.close(new Error("会话已断开，文件传输停止。"));
            }
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
            transferByteQueuesRef.current
              .get(event.sessionId)
              ?.push(event.bytes);
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
        const startLog =
          profile.protocol === "serial" ? startSerialLog : startProcessLog;
        const path = await startLog(
          sessionId,
          profile.name,
          profile.logging.mode,
          profile.terminal.encoding,
          profile.logging.append,
          profile.logging.maxFileSizeMiB,
          profile.logging.rotateCount,
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
      if (!hasConnectionTarget(profile)) {
        setEditingProfile(profile);
        setSessionDialogOpen(true);
        return;
      }

      const alreadyOpen = sessions.find(
        (session) => session.profileId === profile.id,
      );
      if (alreadyOpen && !existingId) {
        activateSession(alreadyOpen.id);
        if (
          alreadyOpen.state === "disconnected" ||
          alreadyOpen.state === "error" ||
          alreadyOpen.state === "deviceLost"
        ) {
          await closeConfiguredSession(alreadyOpen.id, profile).catch(
            () => undefined,
          );
          setSessions((current) =>
            current.map((item) =>
              item.id === alreadyOpen.id
                ? { ...item, state: "opening", notice: undefined }
                : item,
            ),
          );
          try {
            await openConfiguredSession(alreadyOpen.id, profile, applyEvent);
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
              recoverable:
                profile.protocol === "serial" &&
                profile.serial.autoReconnect,
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
        await closeConfiguredSession(sessionId, profile).catch(
          () => undefined,
        );
        setSessions((current) =>
          current.map((session) =>
            session.id === sessionId
              ? { ...session, state: "opening", notice: undefined }
              : session,
          ),
        );
      }
      activateSession(sessionId);
      if (profile.protocol === "serial") {
        setDtr(profile.serial.dtrOnOpen);
        setRts(profile.serial.rtsOnOpen);
      }

      try {
        await openConfiguredSession(sessionId, profile, applyEvent);
        if (profile.logging.autoStart) {
          await startLogging(sessionId, profile);
        }
      } catch (error) {
        applyEvent({
          type: "error",
          sessionId,
          code: "OPEN_FAILED",
          message: error instanceof Error ? error.message : String(error),
          recoverable:
            profile.protocol === "serial" && profile.serial.autoReconnect,
        });
      }
    },
    [activateSession, applyEvent, sessions, startLogging],
  );

  useEffect(() => {
    const liveSessionIds = new Set(sessions.map((session) => session.id));
    for (const sessionId of triggerEvaluatorsRef.current.keys()) {
      if (!liveSessionIds.has(sessionId)) {
        triggerEvaluatorsRef.current.delete(sessionId);
        processedTriggerChunksRef.current.delete(sessionId);
        startingTriggerLogsRef.current.delete(sessionId);
      }
    }

    for (const session of sessions) {
      if (session.state !== "connected") {
        triggerEvaluatorsRef.current.delete(session.id);
        continue;
      }
      const chunk = session.lastChunk;
      if (
        !chunk ||
        processedTriggerChunksRef.current.get(session.id) === chunk.nonce
      ) {
        continue;
      }
      processedTriggerChunksRef.current.set(session.id, chunk.nonce);
      const profile = profiles.find((item) => item.id === session.profileId);
      if (!profile?.triggers.some((trigger) => trigger.enabled)) continue;

      let evaluatorEntry = triggerEvaluatorsRef.current.get(session.id);
      if (
        !evaluatorEntry ||
        evaluatorEntry.encoding !== profile.terminal.encoding
      ) {
        evaluatorEntry = {
          encoding: profile.terminal.encoding,
          evaluator: new SessionTriggerEvaluator(profile.terminal.encoding),
        };
        triggerEvaluatorsRef.current.set(session.id, evaluatorEntry);
      }
      const matches = evaluatorEntry.evaluator.feed(
        new Uint8Array(chunk.bytes),
        profile.triggers,
        chunk.receivedAtMs,
      );

      for (const match of matches) {
        if (match.rule.action === "notification") {
          setSessions((current) =>
            current.map((item) =>
              item.id === session.id
                ? {
                    ...item,
                    notice: {
                      tone: "info",
                      title: match.rule.payload,
                      detail: `触发器：${match.rule.name} · 匹配：${match.matchedText}`,
                    },
                  }
                : item,
            ),
          );
          continue;
        }

        if (match.rule.action === "sendText") {
          if (session.transferActive) continue;
          void writeConfiguredText(
            session.id,
            profile,
            match.rule.payload,
            "none",
          )
            .then((byteCount) =>
              setSessions((current) =>
                current.map((item) =>
                  item.id === session.id
                    ? {
                        ...item,
                        bytesWritten: item.bytesWritten + byteCount,
                      }
                    : item,
                ),
              ),
            )
            .catch((error) =>
              setSessions((current) =>
                current.map((item) =>
                  item.id === session.id
                    ? {
                        ...item,
                        notice: {
                          tone: "error",
                          title: `触发器“${match.rule.name}”发送失败`,
                          detail:
                            error instanceof Error
                              ? error.message
                              : String(error),
                        },
                      }
                    : item,
                ),
              ),
            );
          continue;
        }

        if (
          match.rule.action === "startLog" &&
          session.logState !== "recording" &&
          session.logState !== "paused" &&
          !startingTriggerLogsRef.current.has(session.id)
        ) {
          startingTriggerLogsRef.current.add(session.id);
          void startLogging(session.id, profile).finally(() =>
            startingTriggerLogsRef.current.delete(session.id),
          );
        }
      }
    }
  }, [profiles, sessions, startLogging]);

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
          profile?.protocol === "serial" &&
          profile.serial.autoReconnect &&
          ports.some((port) => port.path === profile.serial.portPath)
        ) {
          void connectProfile(profile, session.id);
        }
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [connectProfile, ports, profiles, sessions]);

  const disconnectSession = async (session: RuntimeSession) => {
    const profile = profiles.find((item) => item.id === session.profileId);
    setSessions((current) =>
      current.map((item) =>
        item.id === session.id ? { ...item, state: "closing" } : item,
      ),
    );
    try {
      await closeConfiguredSession(session.id, profile);
      setSessions((current) =>
        current.map((item) =>
          item.id === session.id
            ? {
                ...item,
                state: "disconnected",
                logState: "stopped",
                notice: {
                  tone: "info",
                  title: "会话已断开，点击重连可重新建立连接。",
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
    const target = sessions.find((session) => session.id === sessionId);
    if (
      target &&
      preferences.confirmActiveSessionClose &&
      requiresCloseConfirmation(target) &&
      !window.confirm(
        `“${target.title}”仍有活动连接或任务，确定要断开并关闭吗？`,
      )
    ) {
      return;
    }
    const profile = target
      ? profiles.find((item) => item.id === target.profileId)
      : undefined;
    await closeConfiguredSession(sessionId, profile).catch(() => undefined);
    setSessions((current) => current.filter((item) => item.id !== sessionId));
    setActiveSessionId((current) => {
      if (current !== sessionId) return current;
      const remaining = sessions.filter((item) => item.id !== sessionId);
      return remaining.at(-1)?.id ?? null;
    });
  };

  const openNewDialog = () => {
    setEditingProfile(createSessionProfileWithPreferences(preferences, ports[0]));
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
      await closeConfiguredSession(runtime.id, profile).catch(() => undefined);
      const remaining = sessions.filter((session) => session.id !== runtime.id);
      setSessions(remaining);
      setActiveSessionId((current) =>
        current === runtime.id ? (remaining.at(-1)?.id ?? null) : current,
      );
    }
    setProfiles((current) => current.filter((item) => item.id !== profile.id));
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const action = resolveShortcut(
        event,
        isEditableShortcutTarget(event.target),
      );
      if (!action) return;
      event.preventDefault();

      if (action === "escape") {
        if (shortcutHelpOpen) {
          setShortcutHelpOpen(false);
        } else if (appSettingsOpen) {
          setAppSettingsOpen(false);
        } else if (sessionDialogOpen) {
          setSessionDialogOpen(false);
          setEditingProfile(null);
        } else if (focusMode) {
          setFocusMode(false);
        }
        return;
      }
      if (action === "newSession") {
        openNewDialog();
        return;
      }
      if (action === "closeSession" && activeSession) {
        void closeTab(activeSession.id);
        return;
      }
      if (
        (action === "nextSession" || action === "previousSession") &&
        sessions.length > 1
      ) {
        const currentIndex = Math.max(
          0,
          sessions.findIndex((session) => session.id === activeSessionId),
        );
        const offset = action === "nextSession" ? 1 : -1;
        const nextIndex =
          (currentIndex + offset + sessions.length) % sessions.length;
        activateSession(sessions[nextIndex].id);
        return;
      }
      if (action === "toggleSidebar") {
        setSidebarOpen((current) => !current);
        return;
      }
      if (action === "toggleSender") {
        setSenderOpen((current) => !current);
        return;
      }
      if (action === "toggleFocus") {
        setFocusMode((current) => !current);
        return;
      }
      if (action === "sessionSettings" && activeProfile) {
        setEditingProfile(activeProfile);
        setSessionDialogOpen(true);
        return;
      }
      if (
        action === "toggleConnection" &&
        activeSession &&
        activeProfile
      ) {
        if (activeSession.state === "connected") {
          void disconnectSession(activeSession);
        } else if (
          activeSession.state !== "opening" &&
          activeSession.state !== "closing"
        ) {
          void connectProfile(activeProfile, activeSession.id);
        }
        return;
      }
      if (action === "showHelp") setShortcutHelpOpen(true);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    activeProfile,
    activeSession,
    activeSessionId,
    activateSession,
    appSettingsOpen,
    focusMode,
    ports,
    preferences,
    sessionDialogOpen,
    sessions,
    shortcutHelpOpen,
  ]);

  const writeTerminalInput = async (
    runtime: RuntimeSession,
    profile: SessionProfile,
    value: string,
  ) => {
    if (runtime.state !== "connected" || runtime.transferActive) return;
    try {
      const targets =
        runtime.syncChannel === "off"
          ? [runtime]
          : sessions.filter(
              (session) =>
                session.state === "connected" &&
                session.syncChannel === runtime.syncChannel,
            );
      const results = await Promise.all(
        targets.flatMap((target) => {
          const targetProfile = profiles.find(
            (item) => item.id === target.profileId,
          );
          return targetProfile
            ? [
                writeConfiguredText(
                  target.id,
                  targetProfile,
                  value,
                ).then((byteCount) => ({
                  sessionId: target.id,
                  byteCount,
                })),
              ]
            : [];
        }),
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
      throw new Error("会话未连接。");
    }
    if (activeSession.transferActive) {
      throw new Error("文件发送期间不能发送普通数据。");
    }
    const count =
      preset.mode === "hex"
        ? await writeConfiguredBytes(
            activeSession.id,
            activeProfile,
            parseHex(preset.payload),
          )
        : await writeConfiguredText(
            activeSession.id,
            activeProfile,
            preset.payload,
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

  const sendFiles = async (
    files: File[],
    protocol: FileTransferProtocol,
    onProgress: (sentBytes: number, totalBytes: number) => void,
    signal: AbortSignal,
  ): Promise<number> => {
    const file = files[0];
    if (!file) throw new Error("请选择要发送的文件。");
    if (
      !activeSession ||
      !activeProfile ||
      activeSession.state !== "connected" ||
      activeSession.transferActive
    ) {
      throw new Error("会话未连接。");
    }
    const sessionId = activeSession.id;
    const profile = activeProfile;
    const byteQueue =
      protocol === "raw" ? undefined : new AsyncByteQueue();
    if (byteQueue) transferByteQueuesRef.current.set(sessionId, byteQueue);
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? { ...session, transferActive: true }
          : session,
      ),
    );
    try {
      const sendBytes = async (bytes: Uint8Array) => {
        const count = await writeConfiguredBytes(sessionId, profile, bytes);
        setSessions((current) =>
          current.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  bytesWritten: session.bytesWritten + count,
                }
              : session,
          ),
        );
        return count;
      };
      if (protocol === "xmodemCrc" && byteQueue) {
        return await sendXmodemCrc(
          file,
          sendBytes,
          byteQueue,
          onProgress,
          signal,
        );
      }
      if (protocol === "ymodem" && byteQueue) {
        return await sendYmodemBatch(
          files,
          sendBytes,
          byteQueue,
          ({ sentBytes, totalBytes }) => onProgress(sentBytes, totalBytes),
          signal,
        );
      }
      return await sendFileInChunks(
            file,
            sendBytes,
            onProgress,
            signal,
          );
    } finally {
      transferByteQueuesRef.current.delete(sessionId);
      byteQueue?.close();
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? { ...session, transferActive: false }
            : session,
        ),
      );
    }
  };

  const toggleSignal = async (signal: "dtr" | "rts") => {
    if (!activeSession || activeSession.state !== "connected") return;
    const next = signal === "dtr" ? !dtr : !rts;
    await setSerialSignal(activeSession.id, signal, next);
    if (signal === "dtr") setDtr(next);
    else setRts(next);
  };

  const toggleLogPaused = async () => {
    if (!activeSession || !activeProfile) return;
    const paused = activeSession.logState === "recording";
    try {
      const setPaused =
        activeProfile.protocol === "serial"
          ? setSerialLogPaused
          : setProcessLogPaused;
      await setPaused(activeSession.id, paused);
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
    if (!activeSession || !activeProfile) return;
    try {
      const stopLog =
        activeProfile.protocol === "serial"
          ? stopSerialLog
          : stopProcessLog;
      await stopLog(activeSession.id);
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

  const openLogs = async (path?: string) => {
    setUtilityError("");
    try {
      if (path) await openLogFile(path);
      else await openLogDirectory();
    } catch (error) {
      setUtilityError(
        error instanceof Error ? error.message : "无法打开日志位置。",
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

  const changeSplitMode = (mode: Exclude<SplitMode, "single">) => {
    const pair =
      splitSessionIds ??
      createSplitSessionIds(
        sessions.map((session) => session.id),
        activeSessionId,
      );
    if (!pair) return;
    setSplitSessionIds(pair);
    setSplitMode(mode);
    if (!pair.includes(activeSessionId ?? "")) {
      setActiveSessionId(pair[0]);
    }
  };

  const closeSplit = () => {
    setSplitMode("single");
    setSplitSessionIds(null);
  };

  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );

  return (
    <div
      className={`app-shell ${focusMode ? "is-focus-mode" : ""}`}
      data-theme={resolvedTheme}
    >
      <header className="app-menubar">
        <div className="menu-items">
          {["会话", "编辑", "搜索", "选择", "转到", "查看", "模式", "工具", "窗口", "帮助"].map(
            (item) => (
              <button
                key={item}
                onClick={() => item === "帮助" && setShortcutHelpOpen(true)}
                title={item === "帮助" ? "快捷键帮助（Ctrl/⌘+/）" : item}
              >
                {item}
              </button>
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
            title="专注模式（Ctrl/⌘+Shift+F）"
            onClick={() => setFocusMode((current) => !current)}
          >
            <Zap size={16} />
            专注模式
          </button>
          <button
            title={`主题：${
              preferences.theme === "light"
                ? "浅色"
                : preferences.theme === "dark"
                  ? "深色"
                  : "跟随系统"
            }（点击切换）`}
            onClick={() =>
              setPreferences((current) => ({
                ...current,
                theme: nextThemeMode(current.theme),
              }))
            }
          >
            <SunMoon size={16} />
            {preferences.theme === "light"
              ? "浅色"
              : preferences.theme === "dark"
                ? "深色"
                : "系统"}
          </button>
          <button
            title="应用设置"
            onClick={() => setAppSettingsOpen(true)}
          >
            <Menu size={18} />
          </button>
        </div>
      </header>

      <div className="workspace">
        {sidebarOpen && (
          <SessionSidebar
            profiles={profiles}
            ports={ports}
            adbDevices={adbDevices}
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
            onRefresh={() => {
              void refreshPorts();
              void refreshAdbDevices();
            }}
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
                  onClick={() => activateSession(session.id)}
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
            <button
              className={`tab-action ${
                splitMode === "horizontal" ? "is-active" : ""
              }`}
              disabled={sessions.length < 2}
              onClick={() => changeSplitMode("horizontal")}
              title="左右分屏"
            >
              <Columns2 size={17} />
            </button>
            <button
              className={`tab-action ${
                splitMode === "vertical" ? "is-active" : ""
              }`}
              disabled={sessions.length < 2}
              onClick={() => changeSplitMode("vertical")}
              title="上下分屏"
            >
              <Rows2 size={17} />
            </button>
            {splitMode !== "single" && (
              <button
                className="tab-action"
                onClick={closeSplit}
                title="关闭分屏"
              >
                <PanelTopClose size={17} />
              </button>
            )}
            <button
              className="tab-action"
              onClick={openNewDialog}
              title="新建会话（Ctrl/⌘+N）"
            >
              <CirclePlus size={18} />
            </button>
            <button className="tab-action" title="标签列表">
              <Menu size={17} />
            </button>
          </div>

          <div className="session-toolbar">
            <div className="toolbar-group">
              <button
                className="icon-button"
                onClick={openNewDialog}
                title="新建会话（Ctrl/⌘+N）"
              >
                <CirclePlus size={19} />
              </button>
              {activeSession?.state === "connected" ? (
                <button
                  className="icon-button"
                  onClick={() => void disconnectSession(activeSession)}
                  title="断开会话（Ctrl/⌘+Enter）"
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
                  title="连接会话（Ctrl/⌘+Enter）"
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
                title="会话设置（Ctrl/⌘+,）"
              >
                <Settings size={18} />
              </button>
            </div>

            <div className="session-breadcrumb">
              <Info size={17} />
              <span className="breadcrumb-divider" />
              <ChevronDown size={13} />
              <strong>{activeProfile?.protocol ?? "session"}</strong>
              <ChevronDown size={13} />
              <span>
                {activeProfile
                  ? sessionTargetLabel(activeProfile)
                  : "尚未打开会话"}
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
                className="icon-button"
                disabled={!activeSession?.logPath}
                onClick={() =>
                  activeSession?.logPath &&
                  void openLogs(activeSession.logPath)
                }
                title="打开当前日志文件"
              >
                <FileText size={16} />
              </button>
              <button
                className="icon-button"
                onClick={() => void openLogs()}
                title="打开日志目录"
              >
                <FolderOpen size={16} />
              </button>
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
                disabled={
                  activeProfile?.protocol !== "serial" ||
                  activeSession?.state !== "connected"
                }
                onClick={() => void toggleSignal("dtr")}
                title="切换 DTR"
              >
                DTR
              </button>
              <button
                className={`signal-button ${rts ? "is-active" : ""}`}
                disabled={
                  activeProfile?.protocol !== "serial" ||
                  activeSession?.state !== "connected"
                }
                onClick={() => void toggleSignal("rts")}
                title="切换 RTS"
              >
                RTS
              </button>
              <button
                className="icon-button"
                disabled={
                  activeProfile?.protocol !== "serial" ||
                  activeSession?.state !== "connected"
                }
                onClick={() =>
                  activeSession && void sendSerialBreak(activeSession.id)
                }
                title="发送 Break"
              >
                <CircleStop size={18} />
              </button>
              <button
                className="icon-button"
                disabled={
                  activeProfile?.protocol !== "serial" ||
                  activeSession?.state !== "connected"
                }
                onClick={() =>
                  activeSession &&
                  void clearSerialBuffers(activeSession.id, "all")
                }
                title="清空串口输入/输出缓冲"
              >
                <Eraser size={17} />
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

          {adbError && (
            <div className="notice-bar error">
              <Info size={18} />
              <div>
                <strong>读取 ADB 设备失败</strong>
                <span>{adbError}</span>
              </div>
              <button onClick={() => setAdbError("")}>
                <X size={17} />
              </button>
            </div>
          )}

          {utilityError && (
            <div className="notice-bar error">
              <Info size={18} />
              <div>
                <strong>无法打开日志位置</strong>
                <span>{utilityError}</span>
              </div>
              <button onClick={() => setUtilityError("")}>
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

          <div className={`terminal-stack split-${splitMode}`}>
            {sessions.length === 0 && (
              <div className="welcome-panel">
                <div className="welcome-mark">
                  <Cable size={34} />
                </div>
                <h1>iTerm</h1>
                <p>WindTerm 风格的串口、SSH 与 ADB 终端工作区</p>
                <div className="welcome-actions">
                  <button className="primary-button" onClick={openNewDialog}>
                    <CirclePlus size={17} />
                    新建会话
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      void refreshPorts();
                      void refreshAdbDevices();
                    }}
                  >
                    <RefreshCw size={16} />
                    刷新设备
                  </button>
                </div>
                <div className="available-port-summary">
                  <Cable size={15} />
                  已发现 {ports.length} 个串口设备、{adbDevices.length} 个
                  ADB 设备
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
                  visible={
                    splitMode === "single"
                      ? session.id === activeSessionId
                      : Boolean(splitSessionIds?.includes(session.id))
                  }
                  receiveMode={session.receiveMode}
                  theme={resolvedTheme}
                  onActivate={() => activateSession(session.id)}
                  onResize={(cols, rows) => {
                    setSessions((current) =>
                      current.map((item) =>
                        item.id === session.id &&
                        (item.terminalCols !== cols || item.terminalRows !== rows)
                          ? { ...item, terminalCols: cols, terminalRows: rows }
                          : item,
                      ),
                    );
                    if (
                      profile.protocol !== "serial" &&
                      session.state === "connected"
                    ) {
                      void resizeProcessSession(session.id, cols, rows).catch(
                        (error) =>
                          setSessions((current) =>
                            current.map((item) =>
                              item.id === session.id
                                ? {
                                    ...item,
                                    notice: {
                                      tone: "warning",
                                      title: "远程终端尺寸同步失败",
                                      detail:
                                        error instanceof Error
                                          ? error.message
                                          : String(error),
                                    },
                                  }
                                : item,
                            ),
                          ),
                      );
                    }
                  }}
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

          {senderOpen && sessions.length > 0 && activeProfile && (
            <SenderPane
              key={activeProfile.id}
              profileId={activeProfile.id}
              connected={activeSession?.state === "connected"}
              onClose={() => setSenderOpen(false)}
              onSend={sendPreset}
              onSendFiles={sendFiles}
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
              {activeSession && activeSession.logState !== "stopped" && (
                <span
                  className={`log-status state-${activeSession.logState}`}
                  title={activeSession.logPath}
                >
                  日志{" "}
                  {activeSession.logState === "recording"
                    ? "记录中"
                    : activeSession.logState === "paused"
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
        adbDevices={adbDevices}
        externalTools={externalTools}
        onCancel={() => {
          setSessionDialogOpen(false);
          setEditingProfile(null);
        }}
        onRefreshPorts={() => void refreshPorts()}
        onRefreshAdbDevices={() => void refreshAdbDevices()}
        onRefreshExternalTools={() => void refreshExternalTools()}
        onSave={saveProfile}
      />
      <AppSettingsDialog
        open={appSettingsOpen}
        preferences={preferences}
        onCancel={() => setAppSettingsOpen(false)}
        onSave={(nextPreferences) => {
          setPreferences(nextPreferences);
          setAppSettingsOpen(false);
        }}
      />
      {shortcutHelpOpen && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="shortcut-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcut-dialog-title"
          >
            <header>
              <div>
                <Keyboard size={20} />
                <div>
                  <h2 id="shortcut-dialog-title">键盘快捷键</h2>
                  <p>Ctrl 与 ⌘ 会根据当前平台使用。</p>
                </div>
              </div>
              <button
                className="icon-button"
                onClick={() => setShortcutHelpOpen(false)}
                aria-label="关闭快捷键帮助"
              >
                <X size={17} />
              </button>
            </header>
            <div className="shortcut-list">
              {[
                ["新建会话", "Ctrl/⌘ + N"],
                ["关闭当前标签", "Ctrl/⌘ + W"],
                ["下一个 / 上一个标签", "Ctrl/⌘ + Tab / Shift + Tab"],
                ["连接或断开", "Ctrl/⌘ + Enter"],
                ["会话设置", "Ctrl/⌘ + ,"],
                ["切换会话侧栏", "Ctrl/⌘ + B"],
                ["切换发送窗格", "Ctrl/⌘ + J"],
                ["切换专注模式", "Ctrl/⌘ + Shift + F"],
                ["打开快捷键帮助", "Ctrl/⌘ + /"],
                ["关闭对话框 / 退出专注", "Esc"],
              ].map(([label, keys]) => (
                <div key={label}>
                  <span>{label}</span>
                  <kbd>{keys}</kbd>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
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
