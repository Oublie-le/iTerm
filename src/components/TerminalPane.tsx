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
import { mapTerminalSpecialKey, resetTerminal } from "../lib/terminal";
import type {
  ReceiveMode,
  RuntimeSession,
  SessionProfile,
} from "../lib/types";
import { sessionTargetLabel } from "../lib/types";
import { useI18n } from "../lib/i18n";

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
      allowProposedApi: false,
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
              background: "#22231f",
              foreground: "#e5e5df",
              cursor: "#ff9d00",
              cursorAccent: "#22231f",
              selectionBackground: "#445569",
              black: "#333333",
              red: "#c4265e",
              green: "#86b42b",
              yellow: "#d0a500",
              blue: "#3465a4",
              magenta: "#8c6bc8",
              cyan: "#56adbc",
              white: "#e3e3dd",
              brightBlack: "#666666",
              brightRed: "#f92672",
              brightGreen: "#a6e22e",
              brightYellow: "#f4bf75",
              brightBlue: "#66d9ef",
              brightMagenta: "#ae81ff",
              brightCyan: "#a1efe4",
              brightWhite: "#f8f8f2",
            }
          : {
              background: "#fbfcfb",
              foreground: "#252a28",
              cursor: "#168441",
              cursorAccent: "#fbfcfb",
              selectionBackground: "#b9dfc5",
              black: "#242826",
              red: "#b51d4d",
              green: "#397c20",
              yellow: "#8b6700",
              blue: "#255f9c",
              magenta: "#7045a5",
              cyan: "#267583",
              white: "#dfe3df",
              brightBlack: "#68706d",
              brightRed: "#d42f5f",
              brightGreen: "#4d982e",
              brightYellow: "#a87e0a",
              brightBlue: "#3479b8",
              brightMagenta: "#8c5bc0",
              brightCyan: "#368d9b",
              brightWhite: "#ffffff",
            },
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.open(host);

    try {
      terminal.loadAddon(new WebglAddon());
    } catch {
      // WebGL is an optimization. The DOM/canvas renderer remains functional.
    }

    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === "f"
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
