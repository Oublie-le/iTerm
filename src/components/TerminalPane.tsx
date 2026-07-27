import {
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Clock3,
  Command as CommandIcon,
  Copy,
  ScanText,
  Search,
  SendHorizontal,
  Settings,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { formatHexDump, timestampReceivedText } from "../lib/receive";
import type { ResolvedTheme } from "../lib/preferences";
import {
  installUnicode11,
  clampTerminalFontSize,
  classifyTerminalCompletionResponse,
  DEFAULT_TERMINAL_FONT_SIZE,
  isTerminalCompletionTab,
  MAX_TERMINAL_FONT_SIZE,
  mapTerminalSpecialKey,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_CONVERT_EOL,
} from "../lib/terminal";
import type {
  ReceiveMode,
  RuntimeSession,
  SessionProfile,
} from "../lib/types";
import { sessionTargetLabel } from "../lib/types";
import { useI18n } from "../lib/i18n";
import {
  executeTerminalCommand,
  clampContextMenuPosition,
  TERMINAL_COMMAND_EVENT,
  TERMINAL_SEARCH_EVENT,
  type TerminalUiCommand,
} from "../lib/uiCommands";
import {
  buildCommandSuggestions,
  commandLineEnding,
  consumeTerminalInput,
  loadCommandHistory,
  recordCommand,
  type CommandHistoryEntry,
  type CommandSuggestion,
} from "../lib/commandHistory";
import { loadSenderPresets } from "../lib/senders";
import type { SenderPreset } from "../lib/types";
import { colorizeSerialText } from "../lib/serialColors";
import { resolveTerminalTheme } from "../lib/terminalTheme";

const COMPLETION_RESPONSE_WINDOW_MS = 500;

interface TerminalPaneProps {
  session: RuntimeSession;
  profile: SessionProfile;
  active: boolean;
  visible: boolean;
  receiveMode: ReceiveMode;
  theme: ResolvedTheme;
  onActivate: () => void;
  onResize: (cols: number, rows: number) => void;
  onClear: () => void;
  onInput: (value: string) => void;
  onFontSizeChange: (fontSize: number) => void;
  onOpenSender: () => void;
}

export function TerminalPane({
  session,
  profile,
  active,
  visible,
  receiveMode,
  theme,
  onActivate,
  onResize,
  onClear,
  onInput,
  onFontSizeChange,
  onOpenSender,
}: TerminalPaneProps) {
  const { locale, t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef(onInput);
  const trackedInputRef = useRef(onInput);
  const resizeRef = useRef(onResize);
  const fontSizeRef = useRef(profile.terminal.fontSize);
  const fontSizeChangeRef = useRef(onFontSizeChange);
  const decoderRef = useRef<TextDecoder | null>(null);
  const lastWrittenNonceRef = useRef<number | null>(null);
  const startsNewLineRef = useRef(true);
  const completionPendingRef = useRef(false);
  const completionTimerRef = useRef<number | null>(null);
  const typedCommandRef = useRef("");
  const inlineSuggestionsRef = useRef<CommandSuggestion[]>([]);
  const activeInlineSuggestionRef = useRef(-1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchFound, setSearchFound] = useState<boolean | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandValue, setCommandValue] = useState("");
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [liveCommandValue, setLiveCommandValue] = useState("");
  const [inlineCompletionDismissed, setInlineCompletionDismissed] = useState(false);
  const [activeInlineSuggestion, setActiveInlineSuggestion] = useState(-1);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    hasSelection: boolean;
  } | null>(null);
  const [commandHistory, setCommandHistory] = useState<CommandHistoryEntry[]>(
    () => loadCommandHistory(profile.id),
  );
  const [quickCommands, setQuickCommands] = useState<SenderPreset[]>(
    () => loadSenderPresets(profile.id, localStorage, t("sender.defaultName")),
  );
  const commandSuggestions = useMemo(
    () =>
      buildCommandSuggestions(
        commandValue,
        commandHistory,
        quickCommands,
      ),
    [commandHistory, commandValue, quickCommands],
  );
  const inlineSuggestions = useMemo(
    () =>
      inlineCompletionDismissed || !liveCommandValue.trim()
        ? []
        : buildCommandSuggestions(
            liveCommandValue,
            commandHistory,
            quickCommands,
            7,
          ),
    [
      commandHistory,
      inlineCompletionDismissed,
      liveCommandValue,
      quickCommands,
    ],
  );
  const hexDump = useMemo(
    () =>
      receiveMode === "hex"
        ? formatHexDump(
            session.receiveChunks,
            session.bytesRead - session.receiveBaseOffset,
            profile.terminal.hexColumns,
            undefined,
            profile.terminal.timestamp,
            profile.terminal.hexGroupSize,
          )
        : { text: "", omittedBytes: 0 },
    [
      profile.terminal.hexColumns,
      profile.terminal.hexGroupSize,
      profile.terminal.timestamp,
      receiveMode,
      session.receiveBaseOffset,
      session.bytesRead,
      session.receiveChunks,
    ],
  );

  inputRef.current = onInput;
  trackedInputRef.current = (value: string) => {
    const next = consumeTerminalInput(typedCommandRef.current, value);
    typedCommandRef.current = next.buffer;
    setLiveCommandValue(next.buffer);
    if (
      [...value].some(
        (character) =>
          character === "\b" ||
          character === "\u007f" ||
          character >= " ",
      )
    ) {
      setInlineCompletionDismissed(false);
      setActiveInlineSuggestion(-1);
    }
    if (next.completed.length > 0) {
      let history = commandHistory;
      for (const command of next.completed) {
        history = recordCommand(profile.id, command);
      }
      setCommandHistory(history);
      setInlineCompletionDismissed(false);
      setActiveInlineSuggestion(-1);
    }
    inputRef.current(value);
  };
  inlineSuggestionsRef.current = inlineSuggestions;
  activeInlineSuggestionRef.current = activeInlineSuggestion;
  resizeRef.current = onResize;
  fontSizeRef.current = profile.terminal.fontSize;
  fontSizeChangeRef.current = onFontSizeChange;

  const clearPendingCompletion = () => {
    completionPendingRef.current = false;
    if (completionTimerRef.current !== null) {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
  };

  const startPendingCompletion = () => {
    clearPendingCompletion();
    completionPendingRef.current = true;
    completionTimerRef.current = window.setTimeout(
      clearPendingCompletion,
      COMPLETION_RESPONSE_WINDOW_MS,
    );
  };

  const changeTerminalFontSize = (requestedSize: number) => {
    const fontSize = clampTerminalFontSize(requestedSize);
    if (fontSize === fontSizeRef.current) return;
    fontSizeRef.current = fontSize;
    fontSizeChangeRef.current(fontSize);
    window.setTimeout(() => terminalRef.current?.focus(), 0);
  };

  const refreshCommandSources = () => {
    setCommandHistory(loadCommandHistory(profile.id));
    setQuickCommands(
      loadSenderPresets(profile.id, localStorage, t("sender.defaultName")),
    );
  };

  const openCommandComposer = () => {
    refreshCommandSources();
    setCommandOpen(true);
    setActiveSuggestion(-1);
    window.setTimeout(() => commandInputRef.current?.focus(), 0);
  };

  const openHistoryCommand = (command: string) => {
    refreshCommandSources();
    setCommandValue(command);
    setActiveSuggestion(-1);
    setCommandOpen(true);
    window.setTimeout(() => commandInputRef.current?.focus(), 0);
  };

  const submitQuickCommand = (preset: SenderPreset) => {
    if (
      preset.mode !== "text" ||
      !preset.payload.trim() ||
      session.state !== "connected" ||
      session.transferActive
    ) {
      return;
    }
    const ending = commandLineEnding(
      preset.lineEnding,
      profile.terminal.enterKey,
    );
    trackedInputRef.current(`${preset.payload}${ending}`);
    window.setTimeout(() => terminalRef.current?.focus(), 0);
  };

  const submitCommand = (
    suggestion = activeSuggestion >= 0
      ? commandSuggestions[activeSuggestion]
      : undefined,
  ) => {
    if (session.state !== "connected" || session.transferActive) return;
    const command = (suggestion?.command ?? commandValue).trim();
    if (!command) return;
    const ending = commandLineEnding(
      suggestion?.lineEnding ?? "terminal",
      profile.terminal.enterKey,
    );
    setCommandHistory(recordCommand(profile.id, command));
    typedCommandRef.current = "";
    setLiveCommandValue("");
    setInlineCompletionDismissed(false);
    setActiveInlineSuggestion(-1);
    inputRef.current(`${command}${ending}`);
    setCommandValue("");
    setActiveSuggestion(-1);
    window.setTimeout(() => commandInputRef.current?.focus(), 0);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      allowProposedApi: true,
      convertEol: TERMINAL_CONVERT_EOL,
      cursorBlink: true,
      cursorStyle: profile.terminal.cursorStyle,
      fontFamily: profile.terminal.fontFamily,
      fontSize: profile.terminal.fontSize,
      lineHeight: profile.terminal.lineHeight,
      scrollback: profile.terminal.scrollback,
      tabStopWidth: 8,
      theme: resolveTerminalTheme(
        theme,
        profile.terminal.paletteMode,
        profile.terminal.customPalette,
      ),
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    installUnicode11(terminal);
    terminal.open(host);

    try {
      terminal.loadAddon(new WebglAddon());
    } catch {
      // WebGL is an optimization. The DOM/canvas renderer remains functional.
    }

    terminal.attachCustomKeyEventHandler((event) => {
      const shortcutKey = event.key.toLocaleLowerCase();
      const zoomShortcut =
        event.type === "keydown" &&
        (event.metaKey || event.ctrlKey) &&
        ["+", "=", "-", "_", "0"].includes(shortcutKey);
      if (zoomShortcut) {
        event.preventDefault();
        event.stopPropagation();
        changeTerminalFontSize(
          shortcutKey === "0"
            ? DEFAULT_TERMINAL_FONT_SIZE
            : fontSizeRef.current +
                (shortcutKey === "+" || shortcutKey === "=" ? 1 : -1),
        );
        return false;
      }
      const copyShortcut =
        (event.metaKey && shortcutKey === "c" && terminal.hasSelection()) ||
        (event.ctrlKey && event.shiftKey && shortcutKey === "c");
      const pasteShortcut =
        (event.metaKey && shortcutKey === "v") ||
        (event.ctrlKey && event.shiftKey && shortcutKey === "v");
      if (event.type === "keydown" && (copyShortcut || pasteShortcut)) {
        void executeTerminalCommand(
          copyShortcut ? "copy" : "paste",
          terminal,
          (value) => trackedInputRef.current(value),
        ).catch(() => undefined);
        return false;
      }
      const commandShortcut =
        (event.metaKey && shortcutKey === "k") ||
        (event.ctrlKey && event.shiftKey && shortcutKey === "k");
      if (event.type === "keydown" && commandShortcut) {
        openCommandComposer();
        return false;
      }
      if (
        event.type === "keydown" &&
        (event.ctrlKey || event.metaKey) &&
        shortcutKey === "f"
      ) {
        setSearchOpen(true);
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
        return false;
      }
      if (
        event.type === "keydown" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        inlineSuggestionsRef.current.length > 0
      ) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const count = inlineSuggestionsRef.current.length;
          const current = activeInlineSuggestionRef.current;
          const next =
            event.key === "ArrowDown"
              ? (current + 1 + count) % count
              : (current - 1 + count) % count;
          activeInlineSuggestionRef.current = next;
          setActiveInlineSuggestion(next);
          return false;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setInlineCompletionDismissed(true);
          setActiveInlineSuggestion(-1);
          return false;
        }
        if (event.key === "Tab") {
          const suggestion =
            inlineSuggestionsRef.current[
              activeInlineSuggestionRef.current >= 0
                ? activeInlineSuggestionRef.current
                : 0
            ];
          const current = typedCommandRef.current;
          if (
            suggestion &&
            suggestion.command
              .toLocaleLowerCase()
              .startsWith(current.toLocaleLowerCase()) &&
            suggestion.command.length > current.length
          ) {
            event.preventDefault();
            if (profile.protocol === "serial") {
              startPendingCompletion();
            }
            trackedInputRef.current(suggestion.command.slice(current.length));
            setActiveInlineSuggestion(-1);
            return false;
          }
        }
      }
      if (
        profile.protocol === "serial" &&
        isTerminalCompletionTab(event)
      ) {
        event.preventDefault();
        startPendingCompletion();
        trackedInputRef.current("\t");
        return false;
      }
      const mappedInput = mapTerminalSpecialKey(event, profile.terminal);
      if (mappedInput !== null) {
        trackedInputRef.current(mappedInput);
        return false;
      }
      return true;
    });
    const inputDisposable = terminal.onData((value) => {
      if (completionPendingRef.current && value !== "\t") {
        clearPendingCompletion();
      }
      trackedInputRef.current(value);
    });
    const dimensionsDisposable = terminal.onResize(({ cols, rows }) =>
      resizeRef.current(cols, rows),
    );
    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch {
          // The pane can be hidden between observation and the animation frame.
        }
      });
    });
    resizeObserver.observe(host);

    terminalRef.current = terminal;
    fitRef.current = fit;
    searchRef.current = search;
    decoderRef.current = new TextDecoder(profile.terminal.encoding, {
      fatal: false,
    });
    const replayParts: string[] = [];
    for (const chunk of session.receiveChunks) {
      const decoded = decoderRef.current.decode(new Uint8Array(chunk.bytes), {
        stream: true,
      });
      const timestamped = timestampReceivedText(
        decoded,
        chunk.receivedAtMs,
        startsNewLineRef.current,
      );
      startsNewLineRef.current = timestamped.startsNewLine;
      const text = profile.terminal.timestamp ? timestamped.text : decoded;
      const displayText =
        profile.protocol === "serial" && profile.terminal.semanticColors
          ? colorizeSerialText(text)
          : text;
      if (displayText) replayParts.push(displayText);
      lastWrittenNonceRef.current = chunk.nonce;
    }
    if (replayParts.length > 0) terminal.write(replayParts.join(""));
    terminal.focus();

    return () => {
      resizeObserver.disconnect();
      inputDisposable.dispose();
      dimensionsDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      decoderRef.current = null;
      lastWrittenNonceRef.current = null;
      startsNewLineRef.current = true;
      clearPendingCompletion();
    };
    // Receive history is intentionally replayed only when the terminal itself
    // is recreated by one of the terminal configuration dependencies below.
  }, [
    profile.terminal.cursorStyle,
    profile.terminal.encoding,
    profile.terminal.fontFamily,
    profile.terminal.fontSize,
    profile.terminal.lineHeight,
    profile.terminal.paletteMode,
    profile.terminal.customPalette,
    profile.terminal.backspaceKey,
    profile.terminal.enterKey,
    profile.terminal.scrollback,
    profile.terminal.semanticColors,
    profile.terminal.timestamp,
    profile.id,
    theme,
  ]);

  useEffect(() => {
    typedCommandRef.current = "";
    setLiveCommandValue("");
    setInlineCompletionDismissed(false);
    setActiveInlineSuggestion(-1);
    setCommandValue("");
    setActiveSuggestion(-1);
    refreshCommandSources();
  }, [profile.id]);

  useEffect(() => {
    if (!session.lastChunk || !terminalRef.current || !decoderRef.current) return;
    if (session.lastChunk.nonce === lastWrittenNonceRef.current) return;
    const decoded = decoderRef.current.decode(
      new Uint8Array(session.lastChunk.bytes),
      { stream: true },
    );
    const timestamped = timestampReceivedText(
      decoded,
      session.lastChunk.receivedAtMs,
      startsNewLineRef.current,
    );
    startsNewLineRef.current = timestamped.startsNewLine;
    const text = profile.terminal.timestamp ? timestamped.text : decoded;
    let completionPrefix = "";
    if (completionPendingRef.current) {
      const response = classifyTerminalCompletionResponse(decoded);
      if (response !== "wait") {
        clearPendingCompletion();
        if (response === "newline") completionPrefix = "\r\n";
      }
    }
    const displayText =
      profile.protocol === "serial" && profile.terminal.semanticColors
        ? colorizeSerialText(text)
        : text;
    if (displayText) {
      terminalRef.current.write(`${completionPrefix}${displayText}`);
    }
    lastWrittenNonceRef.current = session.lastChunk.nonce;
  }, [session.lastChunk]);

  useEffect(() => {
    if (!visible) return;
    window.requestAnimationFrame(() => {
      fitRef.current?.fit();
      if (active) terminalRef.current?.focus();
    });
  }, [active, visible]);

  useEffect(() => {
    if (session.state !== "connected" || !terminalRef.current) return;
    resizeRef.current(terminalRef.current.cols, terminalRef.current.rows);
  }, [session.state]);

  useEffect(() => {
    if (!active || !visible) return;
    const openSearch = () => {
      setSearchOpen(true);
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    };
    window.addEventListener(TERMINAL_SEARCH_EVENT, openSearch);
    const executeCommand = (event: Event) => {
      if (!terminalRef.current) return;
      const command = (event as CustomEvent<TerminalUiCommand>).detail;
      if (command === "paste" && session.state !== "connected") return;
      void executeTerminalCommand(
        command,
        terminalRef.current,
        (value) => trackedInputRef.current(value),
      ).catch(() => undefined);
    };
    window.addEventListener(TERMINAL_COMMAND_EVENT, executeCommand);
    return () => {
      window.removeEventListener(TERMINAL_SEARCH_EVENT, openSearch);
      window.removeEventListener(TERMINAL_COMMAND_EVENT, executeCommand);
    };
  }, [active, session.state, visible]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    const dismissImmediately = () => setContextMenu(null);
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("blur", dismissImmediately);
    window.addEventListener("resize", dismissImmediately);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("blur", dismissImmediately);
      window.removeEventListener("resize", dismissImmediately);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [contextMenu]);

  const find = (
    direction: "next" | "previous",
    query = searchTerm,
  ) => {
    if (!query || !searchRef.current) {
      setSearchFound(null);
      return;
    }
    const found =
      direction === "next"
        ? searchRef.current.findNext(query, {
            caseSensitive: false,
            incremental: true,
          })
        : searchRef.current.findPrevious(query, {
            caseSensitive: false,
          });
    setSearchFound(found);
  };

  const clearTerminal = () => {
    terminalRef.current?.clear();
    onClear();
    setSearchFound(null);
  };

  const runContextCommand = (command: TerminalUiCommand) => {
    if (!terminalRef.current) return;
    void executeTerminalCommand(
      command,
      terminalRef.current,
      (value) => trackedInputRef.current(value),
    ).catch(() => undefined);
    setContextMenu(null);
    terminalRef.current.focus();
  };

  return (
    <section
      className={[
        "terminal-pane",
        visible ? "is-visible" : "",
        active ? "is-active" : "",
        commandOpen ? "has-command-composer" : "",
        commandOpen && commandSuggestions.length > 0
          ? "has-command-suggestions"
          : "",
        active ? "has-history-dock has-quickbar" : "",
      ].filter(Boolean).join(" ")}
      aria-label={t("terminal.label", { name: profile.name })}
      onMouseDown={onActivate}
      onContextMenu={(event) => {
        event.preventDefault();
        onActivate();
        const position = clampContextMenuPosition(
          event.clientX,
          event.clientY,
          window.innerWidth,
          window.innerHeight,
        );
        setContextMenu({
          ...position,
          hasSelection: terminalRef.current?.hasSelection() ?? false,
        });
      }}
      onWheel={(event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        changeTerminalFontSize(
          fontSizeRef.current + (event.deltaY < 0 ? 1 : -1),
        );
      }}
    >
      <div
        ref={hostRef}
        className={`terminal-host ${receiveMode === "text" ? "" : "is-hidden"}`}
      />
      {receiveMode === "hex" && (
        <div
          className="terminal-hex-view"
          role="region"
          aria-label={t("terminal.hexView")}
        >
          {hexDump.omittedBytes > 0 && (
            <div className="hex-omitted">
              {t("terminal.hexOmitted", {
                bytes: hexDump.omittedBytes.toLocaleString(locale),
              })}
            </div>
          )}
          <pre>{hexDump.text || t("terminal.waiting")}</pre>
        </div>
      )}
      {searchOpen && receiveMode === "text" && (
        <div className="terminal-tools">
          <div className="terminal-search">
            <Search size={14} />
            <input
              ref={searchInputRef}
              value={searchTerm}
              onChange={(event) => {
                const value = event.target.value;
                setSearchTerm(value);
                window.setTimeout(() => find("next", value), 0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  find(event.shiftKey ? "previous" : "next");
                }
                if (event.key === "Escape") {
                  setSearchOpen(false);
                  terminalRef.current?.focus();
                }
              }}
              placeholder={t("terminal.search")}
              aria-label={t("terminal.search")}
            />
            {searchFound === false && (
              <span className="search-empty">
                {t("terminal.search.empty")}
              </span>
            )}
            <button
              onClick={() => find("previous")}
              title={t("terminal.search.previous")}
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={() => find("next")}
              title={t("terminal.search.next")}
            >
              <ChevronDown size={14} />
            </button>
            <button
              onClick={() => {
                setSearchOpen(false);
                terminalRef.current?.focus();
              }}
              title={t("terminal.search.close")}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      {active && !commandOpen && inlineSuggestions.length > 0 && (
        <div
          className="terminal-inline-completion"
          role="listbox"
          aria-label={t("terminal.command.suggestions")}
        >
          {inlineSuggestions.map((suggestion, index) => (
            <button
              key={suggestion.id}
              className={index === activeInlineSuggestion ? "is-active" : ""}
              role="option"
              aria-selected={index === activeInlineSuggestion}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => openHistoryCommand(suggestion.command)}
              onDoubleClick={() => submitCommand(suggestion)}
            >
              {suggestion.source === "quick" ? (
                <Zap size={13} />
              ) : (
                <Clock3 size={13} />
              )}
              <span>{suggestion.label}</span>
              <small>
                {suggestion.source === "quick"
                  ? t("terminal.command.quick")
                  : `${suggestion.useCount} uses`}
              </small>
            </button>
          ))}
          <footer>
            <span>{liveCommandValue}</span>
            <kbd>Up/Down</kbd>
            <kbd>Tab</kbd>
          </footer>
        </div>
      )}
      {active && (
        <aside
          className="terminal-history-dock"
          aria-label={t("terminal.history.title")}
        >
          <header>
            <Clock3 size={14} />
            <strong>{t("terminal.history.title")}</strong>
            <span>{commandHistory.length}</span>
          </header>
          <div className="terminal-history-list">
            {commandHistory.length === 0 ? (
              <p>{t("terminal.history.empty")}</p>
            ) : (
              commandHistory.slice(0, 200).map((entry) => (
                <button
                  key={entry.command}
                  onClick={() => openHistoryCommand(entry.command)}
                  title={entry.command}
                >
                  <code>{entry.command}</code>
                  <small>{entry.useCount} uses</small>
                </button>
              ))
            )}
          </div>
        </aside>
      )}
      {active && (
        <div
          className="terminal-quickbar"
          aria-label={t("terminal.quickbar.title")}
        >
          <span className="terminal-quickbar-title">
            <Zap size={13} />
            {t("terminal.quickbar.title")}
          </span>
          <div className="terminal-quickbar-commands">
            {quickCommands
              .filter(
                (preset) => preset.mode === "text" && preset.payload.trim(),
              )
              .map((preset) => (
                <button
                  key={preset.id}
                  disabled={
                    session.state !== "connected" || session.transferActive
                  }
                  onClick={() => submitQuickCommand(preset)}
                  title={preset.payload}
                >
                  {preset.name}
                </button>
              ))}
          </div>
          <button
            className="terminal-quickbar-settings"
            onClick={onOpenSender}
            title={t("terminal.quickbar.configure")}
            aria-label={t("terminal.quickbar.configure")}
          >
            <Settings size={14} />
          </button>
        </div>
      )}
      {commandOpen && (
        <div className="command-composer">
          <div className="command-composer-input">
            <CommandIcon size={16} />
            <input
              ref={commandInputRef}
              value={commandValue}
              onFocus={refreshCommandSources}
              onChange={(event) => {
                setCommandValue(event.target.value);
                setActiveSuggestion(-1);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveSuggestion((current) =>
                    Math.min(commandSuggestions.length - 1, current + 1),
                  );
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveSuggestion((current) =>
                    current <= 0
                      ? Math.max(0, commandSuggestions.length - 1)
                      : current - 1,
                  );
                } else if (event.key === "Tab") {
                  const suggestion =
                    commandSuggestions[
                      activeSuggestion >= 0 ? activeSuggestion : 0
                    ];
                  if (suggestion) {
                    event.preventDefault();
                    setCommandValue(suggestion.command);
                    setActiveSuggestion(-1);
                  }
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  submitCommand();
                } else if (event.key === "Escape") {
                  setCommandOpen(false);
                  terminalRef.current?.focus();
                }
              }}
              placeholder={t("terminal.command.placeholder")}
              aria-label={t("terminal.command.input")}
              autoComplete="off"
              spellCheck={false}
            />
            <kbd>↑↓</kbd>
            <kbd>Tab</kbd>
            <button
              onClick={() => submitCommand()}
              disabled={!commandValue.trim() && activeSuggestion < 0}
              title={t("terminal.command.send")}
              aria-label={t("terminal.command.send")}
            >
              <SendHorizontal size={16} />
            </button>
            <button
              onClick={() => {
                setCommandOpen(false);
                terminalRef.current?.focus();
              }}
              title={t("terminal.command.close")}
              aria-label={t("terminal.command.close")}
            >
              <X size={15} />
            </button>
          </div>
          {commandSuggestions.length > 0 && (
            <div
              className="command-suggestions"
              role="listbox"
              aria-label={t("terminal.command.suggestions")}
            >
              {commandSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion.id}
                  className={index === activeSuggestion ? "is-active" : ""}
                  role="option"
                  aria-selected={index === activeSuggestion}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setCommandValue(suggestion.command);
                    setActiveSuggestion(index);
                    commandInputRef.current?.focus();
                  }}
                  onDoubleClick={() => submitCommand(suggestion)}
                >
                  <span className="command-suggestion-icon">
                    {suggestion.source === "quick" ? (
                      <Zap size={14} />
                    ) : (
                      <Clock3 size={14} />
                    )}
                  </span>
                  <span className="command-suggestion-copy">
                    <strong>{suggestion.label}</strong>
                    {suggestion.label !== suggestion.command && (
                      <code>{suggestion.command}</code>
                    )}
                  </span>
                  <small>
                    {suggestion.source === "quick"
                      ? t("terminal.command.quick")
                      : t("terminal.command.history", {
                          count: suggestion.useCount,
                        })}
                  </small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="terminal-context-menu"
          role="menu"
          aria-label={t("terminal.context.title")}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            role="menuitem"
            disabled={!contextMenu.hasSelection}
            onClick={() => runContextCommand("copy")}
          >
            <Copy size={14} />
            <span>{t("terminal.context.copy")}</span>
            <kbd>⌘C</kbd>
          </button>
          <button
            role="menuitem"
            disabled={session.state !== "connected" || session.transferActive}
            onClick={() => runContextCommand("paste")}
          >
            <ClipboardPaste size={14} />
            <span>{t("terminal.context.paste")}</span>
            <kbd>⌘V</kbd>
          </button>
          <button
            role="menuitem"
            onClick={() => runContextCommand("selectAll")}
          >
            <ScanText size={14} />
            <span>{t("terminal.context.selectAll")}</span>
            <kbd>⌘A</kbd>
          </button>
          <div className="terminal-context-separator" role="separator" />
          <button
            role="menuitem"
            disabled={receiveMode === "hex"}
            onClick={() => {
              setContextMenu(null);
              setSearchOpen(true);
              window.setTimeout(() => searchInputRef.current?.focus(), 0);
            }}
          >
            <Search size={14} />
            <span>{t("terminal.context.find")}</span>
            <kbd>⌘F</kbd>
          </button>
          <button
            role="menuitem"
            disabled={session.state !== "connected" || session.transferActive}
            onClick={() => {
              setContextMenu(null);
              openCommandComposer();
            }}
          >
            <CommandIcon size={14} />
            <span>{t("terminal.context.command")}</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="terminal-context-separator" role="separator" />
          <button
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              clearTerminal();
            }}
          >
            <Trash2 size={14} />
            <span>{t("terminal.context.clear")}</span>
          </button>
        </div>
      )}
      {session.state === "opening" && (
        <div className="terminal-loading">
          <span className="spinner" />
          {t("terminal.opening", {
            target: sessionTargetLabel(profile, {
              sshUnset: t("profile.target.sshUnset"),
              adbUnset: t("profile.target.adbUnset"),
              serialUnset: t("profile.target.serialUnset"),
            }),
          })}
        </div>
      )}
    </section>
  );
}
