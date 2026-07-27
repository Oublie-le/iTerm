export type ShortcutAction =
  | "newSession"
  | "closeSession"
  | "nextSession"
  | "previousSession"
  | "toggleSidebar"
  | "toggleSender"
  | "toggleFocus"
  | "toggleConnection"
  | "sessionSettings"
  | "showHelp"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "escape";

export interface ShortcutInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
}

export function resolveShortcut(
  input: ShortcutInput,
  editableTarget: boolean,
): ShortcutAction | undefined {
  if (input.altKey) return undefined;
  if (
    input.key === "Escape" &&
    !input.ctrlKey &&
    !input.metaKey &&
    !input.shiftKey
  ) {
    return "escape";
  }

  const primary = input.ctrlKey || input.metaKey;
  if (!primary || editableTarget) return undefined;
  const key = input.key.toLocaleLowerCase();
  if (key === "+" || key === "=") return "zoomIn";
  if (key === "-" || key === "_") return "zoomOut";
  if (key === "0") return "zoomReset";
  if (input.repeat) return undefined;

  if (input.shiftKey) {
    if (key === "f") return "toggleFocus";
    if (key === "tab") return "previousSession";
    return undefined;
  }

  const actions: Record<string, ShortcutAction> = {
    n: "newSession",
    w: "closeSession",
    b: "toggleSidebar",
    j: "toggleSender",
    ",": "sessionSettings",
    enter: "toggleConnection",
    "/": "showHelp",
    tab: "nextSession",
  };
  return actions[key];
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(".xterm")) return false;
  return Boolean(
    target.closest('input, select, textarea, [contenteditable="true"]'),
  );
}
