import {
  ChevronDown,
  ChevronUp,
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
import type {
  ReceiveMode,
  RuntimeSession,
  SessionProfile,
} from "../lib/types";
import { sessionTargetLabel } from "../lib/types";

interface TerminalPaneProps {
  session: RuntimeSession;
  profile: SessionProfile;
  active: boolean;
  receiveMode: ReceiveMode;
  onResize: (cols: number, rows: number) => void;
  onClear: () => void;
  onInput: (value: string) => void;
}

export function TerminalPane({
  session,
  profile,
  active,
  receiveMode,
  onResize,
  onClear,
  onInput,
}: TerminalPaneProps) {
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
      theme: {
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
    profile.terminal.scrollback,
    profile.terminal.timestamp,
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
    if (!active) return;
    window.requestAnimationFrame(() => {
      fitRef.current?.fit();
      terminalRef.current?.focus();
    });
  }, [active]);

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

  return (
    <section
      className={`terminal-pane ${active ? "is-active" : ""}`}
      aria-label={`${profile.name} 终端`}
    >
      <div
        ref={hostRef}
        className={`terminal-host ${receiveMode === "text" ? "" : "is-hidden"}`}
      />
      {receiveMode === "hex" && (
        <div className="terminal-hex-view" aria-label="Hex 接收视图">
          {hexDump.omittedBytes > 0 && (
            <div className="hex-omitted">
              已隐藏较早的 {hexDump.omittedBytes.toLocaleString()} 字节
            </div>
          )}
          <pre>{hexDump.text || "等待接收数据…"}</pre>
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
              placeholder="查找终端内容"
              aria-label="查找终端内容"
            />
            {searchFound === false && <span className="search-empty">无结果</span>}
            <button onClick={() => find("previous")} title="上一个">
              <ChevronUp size={14} />
            </button>
            <button onClick={() => find("next")} title="下一个">
              <ChevronDown size={14} />
            </button>
            <button
              onClick={() => {
                setSearchOpen(false);
                terminalRef.current?.focus();
              }}
              title="关闭查找"
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
          title="查找（Ctrl/⌘+F）"
        >
          <Search size={15} />
        </button>
        <button
          className="terminal-tool-button"
          onClick={clearTerminal}
          title="清空接收视图"
        >
          <Trash2 size={15} />
        </button>
      </div>
      {session.state === "opening" && (
        <div className="terminal-loading">
          <span className="spinner" />
          正在打开 {sessionTargetLabel(profile)}…
        </div>
      )}
    </section>
  );
}
