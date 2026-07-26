import { useEffect, useMemo, useRef } from "react";
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

interface TerminalPaneProps {
  session: RuntimeSession;
  profile: SessionProfile;
  active: boolean;
  receiveMode: ReceiveMode;
  onInput: (value: string) => void;
}

export function TerminalPane({
  session,
  profile,
  active,
  receiveMode,
  onInput,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const inputRef = useRef(onInput);
  const decoderRef = useRef<TextDecoder | null>(null);
  const lastWrittenNonceRef = useRef<number | null>(null);
  const startsNewLineRef = useRef(true);
  const hexDump = useMemo(
    () =>
      formatHexDump(
        session.receiveChunks,
        session.bytesRead,
        16,
        undefined,
        profile.terminal.timestamp,
      ),
    [
      profile.terminal.timestamp,
      session.bytesRead,
      session.receiveChunks,
    ],
  );

  inputRef.current = onInput;

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

    const inputDisposable = terminal.onData((value) => inputRef.current(value));
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
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
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
      {session.state === "opening" && (
        <div className="terminal-loading">
          <span className="spinner" />
          正在打开 {profile.serial.portPath || "串口"}…
        </div>
      )}
    </section>
  );
}
