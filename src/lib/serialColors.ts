const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/;

const SEMANTIC_COLORS: Array<{
  pattern: RegExp;
  open: string;
}> = [
  {
    pattern: /\b(error|fatal|panic|failed|failure|assert(?:ion)?)\b/i,
    open: "\u001b[1;31m",
  },
  {
    pattern: /\b(warn(?:ing)?|caution|deprecated)\b/i,
    open: "\u001b[1;33m",
  },
  {
    pattern: /\b(success|ready|passed|connected|complete(?:d)?|done|ok)\b/i,
    open: "\u001b[1;32m",
  },
  {
    pattern: /\b(info|notice|boot(?:ing)?|start(?:ing|ed)?)\b/i,
    open: "\u001b[36m",
  },
  {
    pattern: /\b(debug|trace|verbose)\b/i,
    open: "\u001b[2;37m",
  },
];

export function colorizeSerialText(text: string): string {
  if (!text) return text;
  return text.replace(/[^\r\n]+(?:\r\n|\r|\n|$)/g, (line) => {
    if (ANSI_ESCAPE.test(line)) return line;
    const color = SEMANTIC_COLORS.find(({ pattern }) => pattern.test(line));
    return color ? `${color.open}${line}\u001b[0m` : line;
  });
}
