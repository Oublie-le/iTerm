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
  listSshConfigHosts,
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
  type SshConfigHost,
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
import {
  AsyncByteQueue,
  receiveXmodemCrc,
  sendXmodemCrc,
} from "./lib/xmodem";
import { sendYmodemBatch } from "./lib/ymodem";
import {
  receiveYmodemBatch,
  type YmodemReceiveProgress,
} from "./lib/ymodemReceive";
import {
  saveReceivedBinaryFile,
  saveReceivedBinaryFiles,
  selectBinaryOutputDirectory,
  selectBinaryOutputFile,
} from "./lib/binaryFiles";
import {
  ZmodemSentryBridge,
  receiveZmodemFiles,
  sendZmodemFiles,
  type ZmodemProgress,
} from "./lib/zmodem";
import { openJsonDocument, saveJsonDocument } from "./lib/jsonFiles";
import {
  mergeImportedProfiles,
  parseSessionProfiles,
  serializeSessionProfiles,
} from "./lib/profileTransfer";
import {
  clearDiagnosticEvents,
  loadDiagnosticEvents,
  recordDiagnostic,
  serializeDiagnosticEvents,
  type DiagnosticLevel,
} from "./lib/diagnostics";
import {
  clearPersistentStorage,
  getLatestPersistenceError,
  PERSISTENCE_ERROR_EVENT,
  setPersistentItem,
} from "./lib/persistence";
import {
  createTranslator,
  I18nProvider,
  resolveLocale,
  type TranslationKey,
  type Translator,
} from "./lib/i18n";
import { localizedErrorMessage } from "./lib/errorMessages";
import {
  requestTerminalCommand,
  requestTerminalSearch,
} from "./lib/uiCommands";
import {
  clampTerminalFontSize,
  DEFAULT_TERMINAL_FONT_SIZE,
} from "./lib/terminal";

const PROFILE_STORAGE_KEY = "iterm.profiles.v1";
const LEGACY_PROFILE_STORAGE_KEY = "serialterm.profiles.v1";
const MAX_RECONNECT_ATTEMPTS = 8;

type TopMenuId =
  | "session"
  | "edit"
  | "search"
  | "select"
  | "go"
  | "view"
  | "mode"
  | "tools"
  | "window"
  | "help";

interface TopMenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

interface TopMenuDefinition {
  id: TopMenuId;
  labelKey: TranslationKey;
  items: TopMenuItem[];
}

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

function stateLabel(
  state: RuntimeSession["state"],
  t: Translator,
): string {
  const labels: Record<RuntimeSession["state"], TranslationKey> = {
    disconnected: "state.disconnected",
    opening: "state.opening",
    connected: "state.connected",
    closing: "state.closing",
    deviceLost: "state.deviceLost",
    error: "state.error",
  };
  return t(labels[state]);
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
  const [sshConfigHosts, setSshConfigHosts] = useState<SshConfigHost[]>([]);
  const [sessions, setSessions] = useState<RuntimeSession[]>(() =>
    initialWorkspace.openProfileIds.flatMap((profileId) => {
      const profile = profiles.find((item) => item.id === profileId);
      if (!profile) return [];
      return [
        {
          ...createRuntimeSession(profile),
          notice: {
            tone: "info" as const,
            title: createTranslator(preferences.locale)(
              "runtime.workspaceRestored",
            ),
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
  const [tabListOpen, setTabListOpen] = useState(false);
  const [activeTopMenu, setActiveTopMenu] = useState<TopMenuId | null>(null);
  const [editingProfile, setEditingProfile] =
    useState<SessionProfile | null>(null);
  const [sidebarFilter, setSidebarFilter] = useState("");
  const [portError, setPortError] = useState("");
  const [adbError, setAdbError] = useState("");
  const [utilityError, setUtilityError] = useState("");
  const [persistenceError, setPersistenceError] = useState(
    getLatestPersistenceError,
  );
  const [profileTransferNotice, setProfileTransferNotice] = useState<{
    tone: "info" | "error";
    title: string;
    detail?: string;
  } | null>(null);
  const [diagnosticCount, setDiagnosticCount] = useState(
    () => loadDiagnosticEvents().length,
  );
  const [dtr, setDtr] = useState(true);
  const [rts, setRts] = useState(true);
  const refreshInFlightRef = useRef(false);
  const adbRefreshInFlightRef = useRef(false);
  const tabListRef = useRef<HTMLDivElement>(null);
  const topMenuBarRef = useRef<HTMLDivElement>(null);
  const triggerEvaluatorsRef = useRef(
    new Map<
      string,
      { encoding: string; evaluator: SessionTriggerEvaluator }
    >(),
  );
  const processedTriggerChunksRef = useRef(new Map<string, number>());
  const startingTriggerLogsRef = useRef(new Set<string>());
  const transferByteQueuesRef = useRef(new Map<string, AsyncByteQueue>());
  const zmodemBridgesRef = useRef(
    new Map<string, ZmodemSentryBridge>(),
  );
  const captureDiagnostic = useCallback(
    (
      area: string,
      event: string,
      options: {
        level?: DiagnosticLevel;
        message?: string;
        context?: Record<string, unknown>;
      } = {},
    ) => {
      recordDiagnostic(area, event, options);
      setDiagnosticCount(loadDiagnosticEvents().length);
    },
    [],
  );

  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );
  const activeProfile = profiles.find(
    (profile) => profile.id === activeSession?.profileId,
  );
  const changeProfileFontSize = useCallback(
    (profileId: string, requestedSize: number) => {
      const fontSize = clampTerminalFontSize(requestedSize);
      setProfiles((current) =>
        current.map((profile) =>
          profile.id === profileId &&
          profile.terminal.fontSize !== fontSize
            ? {
                ...profile,
                terminal: { ...profile.terminal, fontSize },
                updatedAt: new Date().toISOString(),
              }
            : profile,
        ),
      );
    },
    [],
  );
  const resolvedTheme = resolveTheme(preferences.theme, systemPrefersDark);
  const resolvedLocale = resolveLocale(
    preferences.locale,
    navigator.language,
  );
  const t = useMemo(
    () => createTranslator(resolvedLocale),
    [resolvedLocale],
  );
  const workspaceSessionIdentity = sessions
    .map((session) => `${session.id}:${session.profileId}`)
    .join("|");

  useEffect(() => {
    captureDiagnostic("app", "started", {
      context: {
        profileCount: profiles.length,
        restoredSessionCount: sessions.length,
      },
    });
    // Startup is recorded once; later profile/session changes are separate events.
  }, [captureDiagnostic]);

  useEffect(() => {
    document.documentElement.lang = resolvedLocale;
  }, [resolvedLocale]);

  useEffect(() => {
    if (!tabListOpen) return;
    const dismissOnPointerDown = (event: PointerEvent) => {
      if (!tabListRef.current?.contains(event.target as Node)) {
        setTabListOpen(false);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTabListOpen(false);
    };
    window.addEventListener("pointerdown", dismissOnPointerDown);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismissOnPointerDown);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [tabListOpen]);

  useEffect(() => {
    if (!activeTopMenu) return;
    const dismissOnPointerDown = (event: PointerEvent) => {
      if (!topMenuBarRef.current?.contains(event.target as Node)) {
        setActiveTopMenu(null);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveTopMenu(null);
    };
    window.addEventListener("pointerdown", dismissOnPointerDown);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismissOnPointerDown);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [activeTopMenu]);

  useEffect(() => {
    const restoredMessages = new Set([
      createTranslator("zh-CN")("runtime.workspaceRestored"),
      createTranslator("en-US")("runtime.workspaceRestored"),
    ]);
    setSessions((current) =>
      current.map((session) =>
        session.notice && restoredMessages.has(session.notice.title)
          ? {
              ...session,
              notice: {
                ...session.notice,
                title: t("runtime.workspaceRestored"),
              },
            }
          : session,
      ),
    );
  }, [t]);

  useEffect(() => {
    const handlePersistenceError = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      setPersistenceError(localizedErrorMessage(message, resolvedLocale));
      captureDiagnostic("persistence", "sync_failed", {
        level: "error",
        message,
      });
    };
    window.addEventListener(
      PERSISTENCE_ERROR_EVENT,
      handlePersistenceError,
    );
    return () =>
      window.removeEventListener(
        PERSISTENCE_ERROR_EVENT,
        handlePersistenceError,
      );
  }, [captureDiagnostic, resolvedLocale]);

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
          localizedErrorMessage(
            error,
            resolvedLocale,
            t("runtime.serialListFallback"),
          ),
        );
      }
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [resolvedLocale, t]);

  const refreshAdbDevices = useCallback(async (silent = false) => {
    if (adbRefreshInFlightRef.current) return;
    adbRefreshInFlightRef.current = true;
    if (!silent) setAdbError("");
    try {
      setAdbDevices(await listAdbDevices());
      setAdbError("");
    } catch (error) {
      setAdbDevices([]);
      if (!silent) {
        setAdbError(
          localizedErrorMessage(
            error,
            resolvedLocale,
            t("runtime.adbListFallback"),
          ),
        );
      }
    } finally {
      adbRefreshInFlightRef.current = false;
    }
  }, [resolvedLocale, t]);

  const refreshExternalTools = useCallback(async () => {
    setExternalTools(await listExternalTools());
    try {
      setSshConfigHosts(await listSshConfigHosts());
    } catch {
      setSshConfigHosts([]);
    }
  }, []);

  useEffect(() => {
    void refreshPorts();
    const timer = window.setInterval(() => void refreshPorts(true), 2_000);
    return () => window.clearInterval(timer);
  }, [refreshPorts]);

  useEffect(() => {
    void refreshAdbDevices(true);
    const timer = window.setInterval(
      () => void refreshAdbDevices(true),
      5_000,
    );
    return () => window.clearInterval(timer);
  }, [refreshAdbDevices]);

  useEffect(() => {
    void refreshExternalTools();
  }, [refreshExternalTools]);

  useEffect(() => {
    setPersistentItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
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
    sidebarOpen,
    splitMode,
    splitSessionIds,
    workspaceSessionIdentity,
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
    const displayMessage = "message" in event && event.message
      ? localizedErrorMessage(event.message, resolvedLocale)
      : undefined;
    if (event.type === "state") {
      captureDiagnostic("session", "state_changed", {
        level:
          event.state === "error" || event.state === "deviceLost"
            ? "warning"
            : "info",
        message: event.message,
        context: { sessionId: event.sessionId, state: event.state },
      });
    } else if (event.type === "error") {
      captureDiagnostic("session", "error", {
        level: "error",
        message: event.message,
        context: {
          sessionId: event.sessionId,
          code: event.code,
          recoverable: event.recoverable,
        },
      });
    } else if (event.type === "log" && event.state === "error") {
      captureDiagnostic("logging", "write_failed", {
        level: "error",
        message: event.message,
        context: { sessionId: event.sessionId },
      });
    }
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
                ?.close(new Error(t("runtime.transferStopped")));
              zmodemBridgesRef.current.get(event.sessionId)?.abort();
              zmodemBridgesRef.current.delete(event.sessionId);
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
                  : displayMessage
                    ? {
                        tone:
                          event.state === "error" ||
                          event.state === "deviceLost"
                            ? ("error" as const)
                            : ("info" as const),
                        title: displayMessage,
                      }
                    : session.notice,
            };
          case "data": {
            const zmodemBridge = zmodemBridgesRef.current.get(event.sessionId);
            if (zmodemBridge) {
              const terminalBytes = zmodemBridge.consume(event.bytes);
              if (terminalBytes.length === 0) {
                return {
                  ...session,
                  sequence: event.sequence,
                  bytesRead: session.bytesRead + event.bytes.length,
                };
              }
              const chunk = {
                nonce: performance.now(),
                sequence: event.sequence,
                receivedAtMs: event.receivedAtMs,
                bytes: Array.from(terminalBytes),
              };
              return {
                ...session,
                sequence: event.sequence,
                receiveChunks: appendReceiveChunk(
                  session.receiveChunks,
                  chunk,
                ),
                lastChunk: chunk,
                bytesRead: session.bytesRead + event.bytes.length,
              };
            }
            const transferQueue = transferByteQueuesRef.current.get(
              event.sessionId,
            );
            transferQueue?.push(event.bytes);
            if (transferQueue) {
              return {
                ...session,
                sequence: event.sequence,
                bytesRead: session.bytesRead + event.bytes.length,
              };
            }
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
                title: localizedErrorMessage(
                  event.message,
                  resolvedLocale,
                ),
                detail: willReconnect
                  ? t("runtime.reconnectAttempt", {
                      code: event.code,
                      attempt: reconnectAttempts,
                      max: MAX_RECONNECT_ATTEMPTS,
                    })
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
                      title: t("runtime.logWriteFailed"),
                      detail: localizedErrorMessage(
                        event.message,
                        resolvedLocale,
                      ),
                    }
                  : session.notice,
            };
        }
      }),
    );
  }, [captureDiagnostic, resolvedLocale, t]);

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
                    title: t("runtime.logStartFailed"),
                    detail: localizedErrorMessage(error, resolvedLocale),
                  },
                }
              : session,
          ),
        );
      }
    },
    [resolvedLocale, t],
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
            captureDiagnostic("session", "open_requested", {
              context: {
                sessionId: alreadyOpen.id,
                profileId: profile.id,
                protocol: profile.protocol,
              },
            });
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
        captureDiagnostic("session", "open_requested", {
          context: { sessionId, profileId: profile.id, protocol: profile.protocol },
        });
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
    [activateSession, applyEvent, captureDiagnostic, sessions, startLogging],
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
                      detail: t("runtime.triggerDetail", {
                        name: match.rule.name,
                        match: match.matchedText,
                      }),
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
                          title: t("runtime.triggerSendFailed", {
                            name: match.rule.name,
                          }),
                          detail: localizedErrorMessage(
                            error,
                            resolvedLocale,
                          ),
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
  }, [profiles, resolvedLocale, sessions, startLogging, t]);

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
                  title: t("runtime.disconnected"),
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
        t("runtime.confirmClose", { name: target.title }),
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
    const duplicate = duplicateSessionProfile(
      profile,
      t("profile.copySuffix"),
    );
    setProfiles((current) => [...current, duplicate]);
    setEditingProfile(duplicate);
    setSessionDialogOpen(true);
  };

  const deleteProfile = async (profile: SessionProfile) => {
    const runtime = sessions.find(
      (session) => session.profileId === profile.id,
    );
    if (!window.confirm(t("runtime.confirmDelete", { name: profile.name }))) {
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

  const exportProfiles = async () => {
    setProfileTransferNotice(null);
    try {
      const date = new Date().toISOString().slice(0, 10);
      const path = await saveJsonDocument(
        `iTerm-sessions-${date}.json`,
        serializeSessionProfiles(profiles),
      );
      if (path) {
        captureDiagnostic("configuration", "profiles_exported", {
          context: { profileCount: profiles.length },
        });
        setProfileTransferNotice({
          tone: "info",
          title: t("runtime.profilesExported", { count: profiles.length }),
          detail: path,
        });
      }
    } catch (error) {
      captureDiagnostic("configuration", "profiles_export_failed", {
        level: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      setProfileTransferNotice({
        tone: "error",
        title: t("runtime.profilesExportFailed"),
        detail: localizedErrorMessage(error, resolvedLocale),
      });
    }
  };

  const importProfiles = async () => {
    setProfileTransferNotice(null);
    try {
      const document = await openJsonDocument();
      if (!document) return;
      const imported = parseSessionProfiles(document.contents);
      const merged = mergeImportedProfiles(profiles, imported);
      setProfiles(merged.profiles);
      captureDiagnostic("configuration", "profiles_imported", {
        context: {
          importedCount: merged.importedCount,
          remappedCount: merged.remappedCount,
        },
      });
      setProfileTransferNotice({
        tone: "info",
        title: t("runtime.profilesImported", {
          count: merged.importedCount,
        }),
        detail:
          merged.remappedCount > 0
            ? t("runtime.profilesRemapped", {
                file: document.name,
                count: merged.remappedCount,
              })
            : document.name,
      });
    } catch (error) {
      captureDiagnostic("configuration", "profiles_import_failed", {
        level: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      setProfileTransferNotice({
        tone: "error",
        title: t("runtime.profilesImportFailed"),
        detail: localizedErrorMessage(error, resolvedLocale),
      });
    }
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
      if (
        action === "zoomIn" ||
        action === "zoomOut" ||
        action === "zoomReset"
      ) {
        if (!activeProfile) return;
        changeProfileFontSize(
          activeProfile.id,
          action === "zoomReset"
            ? DEFAULT_TERMINAL_FONT_SIZE
            : activeProfile.terminal.fontSize +
                (action === "zoomIn" ? 1 : -1),
        );
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
    changeProfileFontSize,
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
      throw new Error(t("runtime.noActiveSession"));
    }
    if (activeSession.state !== "connected") {
      throw new Error(t("runtime.notConnected"));
    }
    if (activeSession.transferActive) {
      throw new Error(t("runtime.transferBusy"));
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
    if (!file) throw new Error(t("runtime.selectFile"));
    if (
      !activeSession ||
      !activeProfile ||
      activeSession.state !== "connected" ||
      activeSession.transferActive
    ) {
      throw new Error(t("runtime.notConnected"));
    }
    const sessionId = activeSession.id;
    const profile = activeProfile;
    if (protocol === "zmodem") {
      const bridge = new ZmodemSentryBridge(async (bytes) => {
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
      });
      zmodemBridgesRef.current.set(sessionId, bridge);
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? { ...session, transferActive: true }
            : session,
        ),
      );
      captureDiagnostic("transfer", "started", {
        context: {
          protocol,
          fileCount: files.length,
          totalBytes: files.reduce((sum, item) => sum + item.size, 0),
        },
      });
      try {
        const zsession = await bridge.waitForSession("send", signal);
        const totalBytes = files.reduce((sum, item) => sum + item.size, 0);
        const transferred = await bridge.guard(
          sendZmodemFiles(
            zsession,
            files,
            ({ fileIndex, transferredBytes }) => {
              const completed = files
                .slice(0, fileIndex)
                .reduce((sum, item) => sum + item.size, 0);
              onProgress(completed + transferredBytes, totalBytes);
            },
            signal,
          ),
        );
        await bridge.flush();
        captureDiagnostic("transfer", "completed", {
          context: { protocol, fileCount: files.length, transferred },
        });
        return transferred;
      } catch (error) {
        captureDiagnostic("transfer", "failed", {
          level: signal.aborted ? "warning" : "error",
          message: signal.aborted
            ? t("runtime.transferCancelled")
            : error instanceof Error
              ? error.message
              : String(error),
          context: { protocol, fileCount: files.length },
        });
        throw error;
      } finally {
        zmodemBridgesRef.current.delete(sessionId);
        setSessions((current) =>
          current.map((session) =>
            session.id === sessionId
              ? { ...session, transferActive: false }
              : session,
          ),
        );
      }
    }
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
    const totalBytes = files.reduce((sum, item) => sum + item.size, 0);
    captureDiagnostic("transfer", "started", {
      context: { protocol, fileCount: files.length, totalBytes },
    });
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
      let transferred: number;
      if (protocol === "xmodemCrc" && byteQueue) {
        transferred = await sendXmodemCrc(
          file,
          sendBytes,
          byteQueue,
          onProgress,
          signal,
        );
      } else if (protocol === "ymodem" && byteQueue) {
        transferred = await sendYmodemBatch(
          files,
          sendBytes,
          byteQueue,
          ({ sentBytes, totalBytes }) => onProgress(sentBytes, totalBytes),
          signal,
        );
      } else {
        transferred = await sendFileInChunks(
          file,
          sendBytes,
          onProgress,
          signal,
        );
      }
      captureDiagnostic("transfer", "completed", {
        context: { protocol, fileCount: files.length, transferred },
      });
      return transferred;
    } catch (error) {
      captureDiagnostic("transfer", "failed", {
        level: signal.aborted ? "warning" : "error",
        message: signal.aborted
          ? t("runtime.transferCancelled")
          : error instanceof Error
            ? error.message
            : String(error),
        context: { protocol, fileCount: files.length },
      });
      throw error;
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

  const receiveYmodemFiles = async (
    onProgress: (progress: YmodemReceiveProgress) => void,
    signal: AbortSignal,
  ): Promise<{ fileCount: number; totalBytes: number } | null> => {
    if (
      !activeSession ||
      !activeProfile ||
      activeSession.state !== "connected" ||
      activeSession.transferActive
    ) {
      throw new Error(t("runtime.notConnected"));
    }
    const outputDirectory = await selectBinaryOutputDirectory(
      t("runtime.selectReceiveDirectory"),
    );
    if (outputDirectory === null) return null;

    const sessionId = activeSession.id;
    const profile = activeProfile;
    const byteQueue = new AsyncByteQueue();
    transferByteQueuesRef.current.set(sessionId, byteQueue);
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? { ...session, transferActive: true }
          : session,
      ),
    );
    captureDiagnostic("transfer", "receive_started", {
      context: { protocol: "ymodem" },
    });
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
      const files = await receiveYmodemBatch(
        sendBytes,
        byteQueue,
        onProgress,
        signal,
      );
      await saveReceivedBinaryFiles(outputDirectory, files);
      const totalBytes = files.reduce(
        (sum, file) => sum + file.bytes.length,
        0,
      );
      captureDiagnostic("transfer", "receive_completed", {
        context: {
          protocol: "ymodem",
          fileCount: files.length,
          totalBytes,
        },
      });
      return { fileCount: files.length, totalBytes };
    } catch (error) {
      captureDiagnostic("transfer", "receive_failed", {
        level: signal.aborted ? "warning" : "error",
        message: signal.aborted
          ? t("runtime.receiveCancelled")
          : error instanceof Error
            ? error.message
            : String(error),
        context: { protocol: "ymodem" },
      });
      throw error;
    } finally {
      transferByteQueuesRef.current.delete(sessionId);
      byteQueue.close();
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? { ...session, transferActive: false }
            : session,
        ),
      );
    }
  };

  const receiveXmodemFile = async (
    onProgress: (receivedBytes: number) => void,
    signal: AbortSignal,
  ): Promise<number | null> => {
    if (
      !activeSession ||
      !activeProfile ||
      activeSession.state !== "connected" ||
      activeSession.transferActive
    ) {
      throw new Error(t("runtime.notConnected"));
    }
    const suggestedName = `xmodem-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.bin`;
    const outputPath = await selectBinaryOutputFile(
      t("runtime.selectReceiveFile"),
      suggestedName,
    );
    if (outputPath === null) return null;

    const sessionId = activeSession.id;
    const profile = activeProfile;
    const byteQueue = new AsyncByteQueue();
    transferByteQueuesRef.current.set(sessionId, byteQueue);
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? { ...session, transferActive: true }
          : session,
      ),
    );
    captureDiagnostic("transfer", "receive_started", {
      context: { protocol: "xmodemCrc" },
    });
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
      const bytes = await receiveXmodemCrc(
        sendBytes,
        byteQueue,
        onProgress,
        signal,
      );
      await saveReceivedBinaryFile(outputPath, suggestedName, bytes);
      captureDiagnostic("transfer", "receive_completed", {
        context: { protocol: "xmodemCrc", fileCount: 1, totalBytes: bytes.length },
      });
      return bytes.length;
    } catch (error) {
      captureDiagnostic("transfer", "receive_failed", {
        level: signal.aborted ? "warning" : "error",
        message: signal.aborted
          ? t("runtime.receiveCancelled")
          : error instanceof Error
            ? error.message
            : String(error),
        context: { protocol: "xmodemCrc" },
      });
      throw error;
    } finally {
      transferByteQueuesRef.current.delete(sessionId);
      byteQueue.close();
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? { ...session, transferActive: false }
            : session,
        ),
      );
    }
  };

  const receiveZmodemBatchFiles = async (
    onProgress: (progress: YmodemReceiveProgress) => void,
    signal: AbortSignal,
  ): Promise<{ fileCount: number; totalBytes: number } | null> => {
    if (
      !activeSession ||
      !activeProfile ||
      activeSession.state !== "connected" ||
      activeSession.transferActive
    ) {
      throw new Error(t("runtime.notConnected"));
    }
    const outputDirectory = await selectBinaryOutputDirectory(
      t("runtime.selectReceiveDirectory"),
    );
    if (outputDirectory === null) return null;
    const sessionId = activeSession.id;
    const profile = activeProfile;
    const bridge = new ZmodemSentryBridge(async (bytes) => {
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
    });
    zmodemBridgesRef.current.set(sessionId, bridge);
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? { ...session, transferActive: true }
          : session,
      ),
    );
    captureDiagnostic("transfer", "receive_started", {
      context: { protocol: "zmodem" },
    });
    try {
      const zsession = await bridge.waitForSession("receive", signal);
      const files = await bridge.guard(
        receiveZmodemFiles(
          zsession,
          (progress: ZmodemProgress) =>
            onProgress({
              fileName: progress.fileName,
              fileIndex: progress.fileIndex,
              receivedBytes: progress.transferredBytes,
              fileSize: progress.fileSize,
            }),
          signal,
        ),
      );
      await bridge.flush();
      await saveReceivedBinaryFiles(outputDirectory, files);
      const totalBytes = files.reduce(
        (sum, file) => sum + file.bytes.length,
        0,
      );
      captureDiagnostic("transfer", "receive_completed", {
        context: {
          protocol: "zmodem",
          fileCount: files.length,
          totalBytes,
        },
      });
      return { fileCount: files.length, totalBytes };
    } catch (error) {
      captureDiagnostic("transfer", "receive_failed", {
        level: signal.aborted ? "warning" : "error",
        message: signal.aborted
          ? t("runtime.receiveCancelled")
          : error instanceof Error
            ? error.message
            : String(error),
        context: { protocol: "zmodem" },
      });
      throw error;
    } finally {
      zmodemBridgesRef.current.delete(sessionId);
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
                  title: t("runtime.logStateFailed"),
                  detail: localizedErrorMessage(error, resolvedLocale),
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
                  title: t("runtime.logStopFailed"),
                  detail: localizedErrorMessage(error, resolvedLocale),
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
        localizedErrorMessage(
          error,
          resolvedLocale,
          t("runtime.logLocationFallback"),
        ),
      );
    }
  };

  const exportDiagnostics = async () => {
    try {
      const events = loadDiagnosticEvents();
      const date = new Date().toISOString().slice(0, 10);
      await saveJsonDocument(
        `iTerm-diagnostics-${date}.json`,
        serializeDiagnosticEvents(
          events,
          new Date().toISOString(),
          resolvedLocale,
        ),
      );
    } catch (error) {
      setProfileTransferNotice({
        tone: "error",
        title: t("runtime.diagnosticsExportFailed"),
        detail: localizedErrorMessage(error, resolvedLocale),
      });
    }
  };

  const clearDiagnostics = () => {
    if (!window.confirm(t("runtime.confirmClearDiagnostics"))) return;
    clearDiagnosticEvents();
    setDiagnosticCount(0);
  };

  const resetAppData = async () => {
    const closeResults = await Promise.allSettled(
      sessions.map((session) =>
        closeConfiguredSession(
          session.id,
          profiles.find((profile) => profile.id === session.profileId),
        ),
      ),
    );
    const closeFailure = closeResults.find(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected",
    );
    if (closeFailure) {
      throw new Error(
        localizedErrorMessage(closeFailure.reason, resolvedLocale),
      );
    }
    await clearPersistentStorage();
    clearDiagnosticEvents();
    window.location.reload();
  };

  const setSyncChannel = (channel: SyncChannel) => {
    if (!activeSession) return;
    setSessions((current) =>
      current.map((session) =>
        session.id === activeSession.id
          ? { ...session, syncChannel: channel }
          : session,
      ),
    );
  };

  const cycleSyncChannel = () => {
    if (!activeSession) return;
    const channels: SyncChannel[] = ["off", "A", "B", "C", "D"];
    const next =
      channels[
        (channels.indexOf(activeSession.syncChannel) + 1) % channels.length
      ];
    setSyncChannel(next);
  };

  const setReceiveMode = (receiveMode: RuntimeSession["receiveMode"]) => {
    if (!activeSession) return;
    setSessions((current) =>
      current.map((session) =>
        session.id === activeSession.id
          ? { ...session, receiveMode }
          : session,
      ),
    );
  };

  const goToRelativeSession = (offset: -1 | 1) => {
    if (sessions.length < 2) return;
    const currentIndex = Math.max(
      0,
      sessions.findIndex((session) => session.id === activeSessionId),
    );
    const nextIndex =
      (currentIndex + offset + sessions.length) % sessions.length;
    activateSession(sessions[nextIndex].id);
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

  const topMenus: TopMenuDefinition[] = [
    {
      id: "session",
      labelKey: "shell.menu.session",
      items: [
        {
          label: t("menu.session.new"),
          shortcut: "Ctrl/⌘+N",
          onSelect: openNewDialog,
        },
        {
          label:
            activeSession?.state === "connected"
              ? t("menu.session.disconnect")
              : t("menu.session.connect"),
          shortcut: "Ctrl/⌘+Enter",
          disabled: !activeProfile,
          separatorBefore: true,
          onSelect: () => {
            if (!activeSession || !activeProfile) return;
            if (activeSession.state === "connected") {
              void disconnectSession(activeSession);
            } else {
              void connectProfile(activeProfile, activeSession.id);
            }
          },
        },
        {
          label: t("menu.session.reconnect"),
          disabled: !activeProfile || activeSession?.state === "opening",
          onSelect: () => {
            if (activeProfile) {
              void connectProfile(activeProfile, activeSession?.id);
            }
          },
        },
        {
          label: t("menu.session.settings"),
          shortcut: "Ctrl/⌘+,",
          disabled: !activeProfile,
          onSelect: () => {
            if (!activeProfile) return;
            setEditingProfile(activeProfile);
            setSessionDialogOpen(true);
          },
        },
        {
          label: t("menu.session.close"),
          shortcut: "Ctrl/⌘+W",
          disabled: !activeSession,
          separatorBefore: true,
          onSelect: () => {
            if (activeSession) void closeTab(activeSession.id);
          },
        },
      ],
    },
    {
      id: "edit",
      labelKey: "shell.menu.edit",
      items: [
        {
          label: t("menu.edit.copy"),
          shortcut: "⌘C / Ctrl+Shift+C",
          disabled: !activeSession,
          onSelect: () => requestTerminalCommand("copy"),
        },
        {
          label: t("menu.edit.paste"),
          shortcut: "⌘V / Ctrl+Shift+V",
          disabled: activeSession?.state !== "connected",
          onSelect: () => requestTerminalCommand("paste"),
        },
      ],
    },
    {
      id: "search",
      labelKey: "shell.menu.search",
      items: [
        {
          label: t("menu.search.find"),
          shortcut: "Ctrl/⌘+F",
          disabled: !activeSession,
          onSelect: requestTerminalSearch,
        },
      ],
    },
    {
      id: "select",
      labelKey: "shell.menu.select",
      items: [
        {
          label: t("menu.select.all"),
          disabled: !activeSession,
          onSelect: () => requestTerminalCommand("selectAll"),
        },
      ],
    },
    {
      id: "go",
      labelKey: "shell.menu.go",
      items: [
        {
          label: t("menu.go.next"),
          shortcut: "Ctrl/⌘+Tab",
          disabled: sessions.length < 2,
          onSelect: () => goToRelativeSession(1),
        },
        {
          label: t("menu.go.previous"),
          shortcut: "Ctrl/⌘+Shift+Tab",
          disabled: sessions.length < 2,
          onSelect: () => goToRelativeSession(-1),
        },
      ],
    },
    {
      id: "view",
      labelKey: "shell.menu.view",
      items: [
        {
          label: t("menu.view.sidebar"),
          shortcut: "Ctrl/⌘+B",
          checked: sidebarOpen,
          onSelect: () => setSidebarOpen((current) => !current),
        },
        {
          label: t("menu.view.sender"),
          shortcut: "Ctrl/⌘+J",
          checked: senderOpen,
          onSelect: () => setSenderOpen((current) => !current),
        },
        {
          label: t("menu.view.focus"),
          shortcut: "Ctrl/⌘+Shift+F",
          checked: focusMode,
          onSelect: () => setFocusMode((current) => !current),
        },
        {
          label: t("menu.view.zoomIn"),
          shortcut: "Ctrl/⌘++",
          disabled: !activeProfile,
          separatorBefore: true,
          onSelect: () => {
            if (activeProfile) {
              changeProfileFontSize(
                activeProfile.id,
                activeProfile.terminal.fontSize + 1,
              );
            }
          },
        },
        {
          label: t("menu.view.zoomOut"),
          shortcut: "Ctrl/⌘+-",
          disabled: !activeProfile,
          onSelect: () => {
            if (activeProfile) {
              changeProfileFontSize(
                activeProfile.id,
                activeProfile.terminal.fontSize - 1,
              );
            }
          },
        },
        {
          label: t("menu.view.zoomReset"),
          shortcut: "Ctrl/⌘+0",
          disabled: !activeProfile,
          onSelect: () => {
            if (activeProfile) {
              changeProfileFontSize(
                activeProfile.id,
                DEFAULT_TERMINAL_FONT_SIZE,
              );
            }
          },
        },
        {
          label: t("menu.view.splitHorizontal"),
          checked: splitMode === "horizontal",
          disabled: sessions.length < 2,
          separatorBefore: true,
          onSelect: () => changeSplitMode("horizontal"),
        },
        {
          label: t("menu.view.splitVertical"),
          checked: splitMode === "vertical",
          disabled: sessions.length < 2,
          onSelect: () => changeSplitMode("vertical"),
        },
        {
          label: t("menu.view.closeSplit"),
          disabled: splitMode === "single",
          onSelect: closeSplit,
        },
      ],
    },
    {
      id: "mode",
      labelKey: "shell.menu.mode",
      items: [
        {
          label: t("menu.mode.text"),
          checked: activeSession?.receiveMode === "text",
          disabled: !activeSession,
          onSelect: () => setReceiveMode("text"),
        },
        {
          label: t("menu.mode.hex"),
          checked: activeSession?.receiveMode === "hex",
          disabled: !activeSession,
          onSelect: () => setReceiveMode("hex"),
        },
        ...(["off", "A", "B", "C", "D"] as SyncChannel[]).map(
          (channel, index): TopMenuItem => ({
            label:
              channel === "off"
                ? t("menu.mode.syncOff")
                : t("menu.mode.syncChannel", { channel }),
            checked: activeSession?.syncChannel === channel,
            disabled: !activeSession,
            separatorBefore: index === 0,
            onSelect: () => setSyncChannel(channel),
          }),
        ),
      ],
    },
    {
      id: "tools",
      labelKey: "shell.menu.tools",
      items: [
        {
          label:
            activeSession?.logState === "recording"
              ? t("menu.tools.pauseLog")
              : activeSession?.logState === "paused"
                ? t("menu.tools.resumeLog")
                : t("menu.tools.startLog"),
          disabled:
            !activeSession ||
            !activeProfile ||
            activeSession.state !== "connected",
          onSelect: () => {
            if (!activeSession || !activeProfile) return;
            if (
              activeSession.logState === "recording" ||
              activeSession.logState === "paused"
            ) {
              void toggleLogPaused();
            } else {
              void startLogging(activeSession.id, activeProfile);
            }
          },
        },
        {
          label: t("menu.tools.stopLog"),
          disabled:
            activeSession?.logState !== "recording" &&
            activeSession?.logState !== "paused",
          onSelect: () => void stopLogging(),
        },
        {
          label: t("menu.tools.openLog"),
          disabled: !activeSession?.logPath,
          onSelect: () => {
            if (activeSession?.logPath) void openLogs(activeSession.logPath);
          },
        },
        {
          label: t("menu.tools.openLogDirectory"),
          onSelect: () => void openLogs(),
        },
        {
          label: t("menu.tools.clearBuffers"),
          disabled:
            activeProfile?.protocol !== "serial" ||
            activeSession?.state !== "connected",
          separatorBefore: true,
          onSelect: () => {
            if (activeSession) void clearSerialBuffers(activeSession.id, "all");
          },
        },
        {
          label: t("menu.tools.sendBreak"),
          disabled:
            activeProfile?.protocol !== "serial" ||
            activeSession?.state !== "connected",
          onSelect: () => {
            if (activeSession) void sendSerialBreak(activeSession.id);
          },
        },
        {
          label: t("menu.tools.refresh"),
          separatorBefore: true,
          onSelect: () => {
            void refreshPorts();
            void refreshAdbDevices();
          },
        },
      ],
    },
    {
      id: "window",
      labelKey: "shell.menu.window",
      items: [
        {
          label: t("menu.window.themeLight"),
          checked: preferences.theme === "light",
          onSelect: () =>
            setPreferences((current) => ({ ...current, theme: "light" })),
        },
        {
          label: t("menu.window.themeDark"),
          checked: preferences.theme === "dark",
          onSelect: () =>
            setPreferences((current) => ({ ...current, theme: "dark" })),
        },
        {
          label: t("menu.window.themeSystem"),
          checked: preferences.theme === "system",
          onSelect: () =>
            setPreferences((current) => ({ ...current, theme: "system" })),
        },
        {
          label: t("menu.window.settings"),
          separatorBefore: true,
          onSelect: () => setAppSettingsOpen(true),
        },
      ],
    },
    {
      id: "help",
      labelKey: "shell.menu.help",
      items: [
        {
          label: t("menu.help.shortcuts"),
          shortcut: "Ctrl/⌘+/",
          onSelect: () => setShortcutHelpOpen(true),
        },
      ],
    },
  ];

  return (
    <I18nProvider locale={resolvedLocale}>
      <div
        className={`app-shell ${focusMode ? "is-focus-mode" : ""}`}
        data-theme={resolvedTheme}
      >
      <header className="app-menubar">
        <div className="app-brand" aria-label="iTerm">
          <span className="app-brand-symbol" aria-hidden="true">
            <Cable size={16} />
          </span>
          <strong>iTerm</strong>
        </div>
        <div className="menu-items" ref={topMenuBarRef}>
          {topMenus.map((menu) => (
            <div className="top-menu" key={menu.id}>
              <button
                className={activeTopMenu === menu.id ? "is-open" : ""}
                aria-haspopup="menu"
                aria-expanded={activeTopMenu === menu.id}
                onClick={() => {
                  setTabListOpen(false);
                  setActiveTopMenu((current) =>
                    current === menu.id ? null : menu.id,
                  );
                }}
                onMouseEnter={() => {
                  if (activeTopMenu) setActiveTopMenu(menu.id);
                }}
                title={t(menu.labelKey)}
              >
                {t(menu.labelKey)}
              </button>
              {activeTopMenu === menu.id && (
                <div className="top-menu-panel" role="menu">
                  {menu.items.map((item, index) => (
                    <button
                      key={`${item.label}-${index}`}
                      className={[
                        item.checked ? "is-checked" : "",
                        item.separatorBefore ? "has-separator" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      role={
                        item.checked === undefined
                          ? "menuitem"
                          : "menuitemcheckbox"
                      }
                      aria-checked={
                        item.checked === undefined ? undefined : item.checked
                      }
                      disabled={item.disabled}
                      onClick={() => {
                        setActiveTopMenu(null);
                        item.onSelect();
                      }}
                    >
                      <span className="top-menu-check">
                        {item.checked ? "✓" : ""}
                      </span>
                      <span className="top-menu-label">{item.label}</span>
                      {item.shortcut && (
                        <kbd className="top-menu-shortcut">
                          {item.shortcut}
                        </kbd>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="menu-actions">
          <button
            title={t("shell.search")}
            onClick={() => requestTerminalSearch()}
            disabled={!activeSession}
          >
            <Search size={17} />
          </button>
          <button
            className={
              activeSession?.syncChannel !== "off" ? "is-active" : ""
            }
            title={t("shell.sync.title")}
            disabled={!activeSession}
            onClick={cycleSyncChannel}
          >
            <Link2 size={17} />
            {t("shell.sync")}{" "}
            {activeSession?.syncChannel === "off"
              ? "—"
              : activeSession?.syncChannel}
          </button>
          <button
            className={focusMode ? "is-active" : ""}
            title={t("shell.focus.title")}
            onClick={() => setFocusMode((current) => !current)}
          >
            <Zap size={16} />
            {t("shell.focus")}
          </button>
          <button
            title={t("shell.theme.title", {
              theme:
                preferences.theme === "light"
                  ? t("shell.theme.light")
                  : preferences.theme === "dark"
                    ? t("shell.theme.dark")
                    : t("shell.theme.system"),
            })}
            onClick={() =>
              setPreferences((current) => ({
                ...current,
                theme: nextThemeMode(current.theme),
              }))
            }
          >
            <SunMoon size={16} />
            {preferences.theme === "light"
              ? t("shell.theme.light")
              : preferences.theme === "dark"
                ? t("shell.theme.dark")
                : t("shell.theme.systemShort")}
          </button>
          <button
            title={t("shell.settings")}
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
            onExport={() => void exportProfiles()}
            onImport={() => void importProfiles()}
          />
        )}

        <main className="main-area">
          <div className="tab-strip">
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarOpen((value) => !value)}
              title={
                sidebarOpen
                  ? t("shell.sidebar.hide")
                  : t("shell.sidebar.show")
              }
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
              title={t("shell.split.horizontal")}
            >
              <Columns2 size={17} />
            </button>
            <button
              className={`tab-action ${
                splitMode === "vertical" ? "is-active" : ""
              }`}
              disabled={sessions.length < 2}
              onClick={() => changeSplitMode("vertical")}
              title={t("shell.split.vertical")}
            >
              <Rows2 size={17} />
            </button>
            {splitMode !== "single" && (
              <button
                className="tab-action"
                onClick={closeSplit}
                title={t("shell.split.close")}
              >
                <PanelTopClose size={17} />
              </button>
            )}
            <button
              className="tab-action"
              onClick={openNewDialog}
              title={t("shell.session.newTitle")}
            >
              <CirclePlus size={18} />
            </button>
            <div className="tab-list-control" ref={tabListRef}>
              <button
                className={`tab-action ${tabListOpen ? "is-active" : ""}`}
                title={t("shell.tabs.list")}
                aria-label={t("shell.tabs.list")}
                aria-haspopup="menu"
                aria-expanded={tabListOpen}
                disabled={sessions.length === 0}
                onClick={() => setTabListOpen((current) => !current)}
              >
                <Menu size={17} />
              </button>
              {tabListOpen && (
                <div className="tab-list-menu" role="menu">
                  {sessions.map((session, index) => (
                    <button
                      key={session.id}
                      className={
                        session.id === activeSessionId ? "is-active" : ""
                      }
                      role="menuitem"
                      onClick={() => {
                        activateSession(session.id);
                        setTabListOpen(false);
                      }}
                    >
                      <span
                        className={`tab-state state-${session.state}`}
                        style={{
                          background:
                            profileById.get(session.profileId)?.color ??
                            "#17a34a",
                        }}
                      />
                      <span>
                        {index + 1}. {session.title}
                      </span>
                      {session.id === activeSessionId && (
                        <small>{t("shell.tabs.current")}</small>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="session-toolbar">
            <div className="toolbar-group">
              <button
                className="icon-button"
                onClick={openNewDialog}
                title={t("shell.session.newTitle")}
              >
                <CirclePlus size={19} />
              </button>
              {activeSession?.state === "connected" ? (
                <button
                  className="icon-button"
                  onClick={() => void disconnectSession(activeSession)}
                  title={t("shell.session.disconnectTitle")}
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
                  title={t("shell.session.connectTitle")}
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
                title={t("shell.session.reconnect")}
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
                title={t("shell.session.settingsTitle")}
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
                  ? sessionTargetLabel(activeProfile, {
                      sshUnset: t("profile.target.sshUnset"),
                      adbUnset: t("profile.target.adbUnset"),
                      serialUnset: t("profile.target.serialUnset"),
                    })
                  : t("shell.session.none")}
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
                        ? t("shell.log.pause")
                        : t("shell.log.resume")
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
                    title={t("shell.log.stop")}
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
                  title={t("shell.log.start")}
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
                title={t("shell.log.openFile")}
              >
                <FileText size={16} />
              </button>
              <button
                className="icon-button"
                onClick={() => void openLogs()}
                title={t("shell.log.openDirectory")}
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
                title={t("shell.receive.toggle")}
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
                title={t("shell.signal.dtr")}
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
                title={t("shell.signal.rts")}
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
                title={t("shell.signal.break")}
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
                title={t("shell.signal.clear")}
              >
                <Eraser size={17} />
              </button>
              <button
                className="icon-button"
                onClick={() => void refreshPorts()}
                title={t("shell.devices.refresh")}
              >
                <RefreshCw size={18} />
              </button>
            </div>
          </div>

          {portError && (
            <div className="notice-bar error">
              <Info size={18} />
              <div>
                <strong>{t("shell.error.serialList")}</strong>
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
                <strong>{t("shell.error.adbList")}</strong>
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
                <strong>{t("shell.error.logLocation")}</strong>
                <span>{utilityError}</span>
              </div>
              <button onClick={() => setUtilityError("")}>
                <X size={17} />
              </button>
            </div>
          )}

          {persistenceError && (
            <div className="notice-bar error">
              <Info size={18} />
              <div>
                <strong>{t("shell.error.persistence")}</strong>
                <span>
                  {persistenceError} {t("shell.error.persistenceFallback")}
                </span>
              </div>
              <button onClick={() => setPersistenceError("")}>
                <X size={17} />
              </button>
            </div>
          )}

          {profileTransferNotice && (
            <div className={`notice-bar ${profileTransferNotice.tone}`}>
              <Info size={18} />
              <div>
                <strong>{profileTransferNotice.title}</strong>
                {profileTransferNotice.detail && (
                  <span>{profileTransferNotice.detail}</span>
                )}
              </div>
              <button onClick={() => setProfileTransferNotice(null)}>
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
                    {t("shell.action.reconnect")}
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
                <p>{t("shell.welcome.subtitle")}</p>
                <div className="welcome-actions">
                  <button className="primary-button" onClick={openNewDialog}>
                    <CirclePlus size={17} />
                    {t("shell.welcome.new")}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      void refreshPorts();
                      void refreshAdbDevices();
                    }}
                  >
                    <RefreshCw size={16} />
                    {t("shell.welcome.refresh")}
                  </button>
                </div>
                <div className="available-port-summary">
                  <Cable size={15} />
                  {t("shell.welcome.discovered", {
                    serialCount: ports.length,
                    adbCount: adbDevices.length,
                  })}
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
                                      title: t("shell.error.remoteResize"),
                                      detail: localizedErrorMessage(
                                        error,
                                        resolvedLocale,
                                      ),
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
                  onFontSizeChange={(fontSize) =>
                    changeProfileFontSize(profile.id, fontSize)
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
              onReceiveXmodem={receiveXmodemFile}
              onReceiveYmodem={receiveYmodemFiles}
              onReceiveZmodem={receiveZmodemBatchFiles}
            />
          )}

          <footer className="statusbar">
            <div>
              <span className="status-logo">
                <Cable size={15} />
              </span>
              <strong>
                {activeSession
                  ? stateLabel(activeSession.state, t)
                  : t("shell.status.ready")}
              </strong>
            </div>
            <div className="status-items">
              <button>
                {activeSession?.state === "connected"
                  ? t("shell.status.remote")
                  : t("shell.status.local")}
              </button>
              <span>
                {t("shell.status.window", {
                  cols: activeSession?.terminalCols ?? 80,
                  rows: activeSession?.terminalRows ?? 24,
                })}
              </span>
              <span>{t("shell.status.line")}</span>
              <span>{t("shell.status.character")}</span>
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
                  {t("shell.status.log")}{" "}
                  {activeSession.logState === "recording"
                    ? t("shell.status.recording")
                    : activeSession.logState === "paused"
                      ? t("shell.status.paused")
                      : t("shell.status.error")}
                </span>
              )}
              <button
                className={senderOpen ? "is-active" : ""}
                onClick={() => setSenderOpen((value) => !value)}
                disabled={sessions.length === 0}
              >
                <PanelBottom size={15} />
                {t("shell.status.sender")}
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
        sshConfigHosts={sshConfigHosts}
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
        diagnosticCount={diagnosticCount}
        onExportDiagnostics={() => void exportDiagnostics()}
        onClearDiagnostics={clearDiagnostics}
        onResetAppData={resetAppData}
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
                  <h2 id="shortcut-dialog-title">
                    {t("shell.shortcuts.title")}
                  </h2>
                  <p>{t("shell.shortcuts.subtitle")}</p>
                </div>
              </div>
              <button
                className="icon-button"
                onClick={() => setShortcutHelpOpen(false)}
                aria-label={t("shell.shortcuts.close")}
              >
                <X size={17} />
              </button>
            </header>
            <div className="shortcut-list">
              {[
                [t("shell.shortcuts.new"), "Ctrl/⌘ + N"],
                [t("shell.shortcuts.closeTab"), "Ctrl/⌘ + W"],
                [
                  t("shell.shortcuts.switchTabs"),
                  "Ctrl/⌘ + Tab / Shift + Tab",
                ],
                [t("shell.shortcuts.connect"), "Ctrl/⌘ + Enter"],
                [t("shell.shortcuts.settings"), "Ctrl/⌘ + ,"],
                [t("shell.shortcuts.sidebar"), "Ctrl/⌘ + B"],
                [t("shell.shortcuts.sender"), "Ctrl/⌘ + J"],
                [t("shell.shortcuts.focus"), "Ctrl/⌘ + Shift + F"],
                [t("shell.shortcuts.help"), "Ctrl/⌘ + /"],
                [t("shell.shortcuts.dismiss"), "Esc"],
                [t("shell.shortcuts.copy"), "⌘C / Ctrl+Shift+C"],
                [t("shell.shortcuts.paste"), "⌘V / Ctrl+Shift+V"],
                [t("shell.shortcuts.zoom"), "Ctrl/⌘ + / - / 0"],
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
          title={t("shell.focus.exitTitle")}
        >
          <Zap size={15} />
          {t("shell.focus.exit")}
        </button>
      )}
      </div>
    </I18nProvider>
  );
}
