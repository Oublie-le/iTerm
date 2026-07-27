import {
  ChevronDown,
  ChevronUp,
  Power,
  RotateCcw,
  Search,
  Trash2,
  X,
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
  mapTerminalSpecialKey,
  resetTerminal,
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
  TERMINAL_COMMAND_EVENT,
  TERMINAL_SEARCH_EVENT,
  type TerminalUiCommand,
} from "../lib/uiCommands";

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
}: TerminalPaneProps) {
  const { locale, t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef(onInput);
  const resizeRef = useRef(onResize);
  const decoderRef = useRef<TextDecoder | null>(null);
  const lastWrittenNonceRef = useRef<number | null>(null);
  const startsNewLineRef = useRef(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchFound, setSearchFound] = useState<boolean | null>(null);
  const hexDump = useMemo(
    () =>
      formatHexDump(
        session.receiveChunks,
        session.bytesRead - session.receiveBaseOffset,
        profile.terminal.hexColumns,
        undefined,
        profile.terminal.timestamp,
        profile.terminal.hexGroupSize,
      ),
    [
      profile.terminal.hexColumns,
      profile.terminal.hexGroupSize,
      profile.terminal.timestamp,
      session.receiveBaseOffset,
      session.bytesRead,
      session.receiveChunks,
    ],
  );

  inputRef.current = onInput;
  resizeRef.current = onResize;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      allowProposedApi: true,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: profile.terminal.cursorStyle,
      fontFamily: profile.terminal.fontFamily,
      fontSize: profile.terminal.fontSize,
      lineHeight: profile.terminal.lineHeight,
      scrollback: profile.terminal.scrollback,
      tabStopWidth: 8,
      theme:
        theme === "dark"
          ? {
              background: "#0d0f12",
              foreground: "#f5f5f7",
              cursor: "#0a84ff",
              cursorAccent: "#ffffff",
              selectionBackground: "#0a84ff66",
              black: "#1c1c1e",
              red: "#ff453a",
              green: "#32d74b",
              yellow: "#ffd60a",
              blue: "#0a84ff",
              magenta: "#bf5af2",
              cyan: "#64d2ff",
              white: "#f2f2f7",
              brightBlack: "#8e8e93",
              brightRed: "#ff6961",
              brightGreen: "#4cdb68",
              brightYellow: "#ffdf3f",
              brightBlue: "#409cff",
              brightMagenta: "#da8fff",
              brightCyan: "#70d7ff",
              brightWhite: "#ffffff",
            }
          : {
              background: "#fbfbfd",
              foreground: "#1d1d1f",
              cursor: "#007aff",
              cursorAccent: "#ffffff",
              selectionBackground: "#007aff4d",
              black: "#1d1d1f",
              red: "#d70015",
              green: "#248a3d",
              yellow: "#a05a00",
              blue: "#0066cc",
              magenta: "#8944ab",
              cyan: "#0071a4",
              white: "#e5e5ea",
              brightBlack: "#6e6e73",
              brightRed: "#ff3b30",
              brightGreen: "#34c759",
              brightYellow: "#ff9f0a",
              brightBlue: "#007aff",
              brightMagenta: "#af52de",
              brightCyan: "#32ade6",
              brightWhite: "#ffffff",
            },
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
          (value) => inputRef.current(value),
        ).catch(() => undefined);
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
      const mappedInput = mapTerminalSpecialKey(event, profile.terminal);
      if (mappedInput !== null) {
        inputRef.current(mappedInput);
        return false;
      }
      return true;
    });
    const inputDisposable = terminal.onData((value) => inputRef.current(value));
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
      if (text) terminal.write(text);
      lastWrittenNonceRef.current = chunk.nonce;
    }
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
    };
    // Receive history is intentionally replayed only when the terminal itself
    // is recreated by one of the terminal configuration dependencies below.
  }, [
    profile.terminal.cursorStyle,
    profile.terminal.encoding,
    profile.terminal.fontFamily,
    profile.terminal.fontSize,
    profile.terminal.lineHeight,
    profile.terminal.backspaceKey,
    profile.terminal.enterKey,
    profile.terminal.scrollback,
    profile.terminal.timestamp,
    theme,
  ]);

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
    if (text) terminalRef.current.write(text);
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
        (value) => inputRef.current(value),
      ).catch(() => undefined);
    };
    window.addEventListener(TERMINAL_COMMAND_EVENT, executeCommand);
    return () => {
      window.removeEventListener(TERMINAL_SEARCH_EVENT, openSearch);
      window.removeEventListener(TERMINAL_COMMAND_EVENT, executeCommand);
    };
  }, [active, session.state, visible]);

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

  const softResetTerminal = () => {
    if (!terminalRef.current) return;
    resetTerminal(terminalRef.current, "soft");
    setSearchFound(null);
  };

  const hardResetTerminal = () => {
    if (!terminalRef.current) return;
    resetTerminal(terminalRef.current, "hard");
    decoderRef.current = new TextDecoder(profile.terminal.encoding, {
      fatal: false,
    });
    startsNewLineRef.current = true;
    onClear();
    setSearchFound(null);
  };

  return (
    <section
      className={`terminal-pane ${visible ? "is-visible" : ""} ${
        active ? "is-active" : ""
      }`}
      aria-label={t("terminal.label", { name: profile.name })}
      onMouseDown={onActivate}
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
      <div className="terminal-tools">
        {searchOpen && receiveMode === "text" && (
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
        )}
        <button
          className="terminal-tool-button"
          disabled={receiveMode === "hex"}
          onClick={() => {
            setSearchOpen(true);
            window.setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
          title={t("terminal.search.title")}
        >
          <Search size={15} />
        </button>
        <button
          className="terminal-tool-button"
          onClick={clearTerminal}
          title={t("terminal.clear")}
        >
          <Trash2 size={15} />
        </button>
        <button
          className="terminal-tool-button"
          onClick={softResetTerminal}
          title={t("terminal.softReset.title")}
          aria-label={t("terminal.softReset")}
        >
          <RotateCcw size={15} />
        </button>
        <button
          className="terminal-tool-button"
          onClick={hardResetTerminal}
          title={t("terminal.hardReset.title")}
          aria-label={t("terminal.hardReset")}
        >
          <Power size={15} />
        </button>
      </div>
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
