const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/;
const LINE_WITH_ENDING = /^([\s\S]*?)(\r\n|\r|\n|)$/;
const SHELL_PROMPT =
  /^(\s*(?:\[[^\]]+\]\s*)?(?:(?:[\w.-]+@)?[\w./:~@-]+)\s*[#$>])(\s*)(.*)$/;
const COLUMN_LISTING = /^(?:\S+\s{2,})+\S+\s*$/;
const PATH_TOKEN = /(^|[\s=:])((?:~|\/)(?:[\w.@+-]+\/?)+)/g;

const SEMANTIC_COLORS: Array<{
  pattern: RegExp;
  open: string;
}> = [
  {
    pattern: /\b(error|fatal|panic|failed|failure|assert(?:ion)?)\b/gi,
    open: "\u001b[1;31m",
  },
  {
    pattern: /\b(warn(?:ing)?|caution|deprecated)\b/gi,
    open: "\u001b[1;33m",
  },
  {
    pattern: /\b(success|ready|passed|connected|complete(?:d)?|done|ok)\b/gi,
    open: "\u001b[1;32m",
  },
  {
    pattern: /\b(info|notice|boot(?:ing)?|start(?:ing|ed)?)\b/gi,
    open: "\u001b[36m",
  },
  {
    pattern: /\b(debug|trace|verbose)\b/gi,
    open: "\u001b[2;37m",
  },
];

function colorizePlainSerialLine(line: string): string {
  const parts = LINE_WITH_ENDING.exec(line);
  if (!parts) return line;
  const [, content, ending] = parts;
  if (!content || ANSI_ESCAPE.test(content)) return line;

  const prompt = SHELL_PROMPT.exec(content);
  if (prompt) {
    const [, prefix, spacing, command] = prompt;
    return command
      ? `\u001b[1;32m${prefix}\u001b[0m${spacing}\u001b[1;36m${command}\u001b[0m${ending}`
      : `\u001b[1;32m${prefix}\u001b[0m${spacing}${ending}`;
  }

  if (COLUMN_LISTING.test(content)) {
    return `${content.replace(
      /\S+/g,
      (token) => `\u001b[1;34m${token}\u001b[0m`,
    )}${ending}`;
  }

  const pathColored = content.replace(
    PATH_TOKEN,
    (_match, prefix: string, path: string) =>
      `${prefix}\u001b[36m${path}\u001b[0m`,
  );
  const semanticColored = SEMANTIC_COLORS.reduce(
    (value, semantic) =>
      value.replace(
        semantic.pattern,
        (token) => `${semantic.open}${token}\u001b[0m`,
      ),
    pathColored,
  );
  return `${semanticColored}${ending}`;
}

export function colorizeSerialText(text: string): string {
  if (!text) return text;
  return text.replace(
    /[^\r\n]+(?:\r\n|\r|\n|$)/g,
    colorizePlainSerialLine,
  );
}
