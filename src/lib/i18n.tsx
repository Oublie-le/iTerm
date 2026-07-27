import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

export type AppLocale = "zh-CN" | "en-US";
export type Translator = (
  key: TranslationKey,
  values?: Record<string, string | number>,
) => string;

const zhCN = {
  "settings.title": "应用设置",
  "settings.subtitle": "应用级默认值只应用于之后创建的新会话。",
  "settings.close": "关闭应用设置",
  "settings.appearance.title": "外观与行为",
  "settings.appearance.subtitle": "控制整个应用的显示和安全确认。",
  "settings.language": "界面语言",
  "settings.language.zh": "简体中文",
  "settings.language.en": "English",
  "settings.theme": "主题",
  "settings.theme.light": "浅色",
  "settings.theme.dark": "深色",
  "settings.theme.system": "跟随系统",
  "settings.closeConfirmation": "关闭确认",
  "settings.closeConfirmation.detail": "关闭活动会话或退出应用前确认",
  "settings.defaults.title": "新会话默认值",
  "settings.defaults.subtitle": "当前会话保存的设置始终优先于这些默认值。",
  "settings.defaultProtocol": "默认协议",
  "settings.protocol.serial": "串口",
  "settings.protocol.ssh": "SSH",
  "settings.protocol.adb": "ADB Shell",
  "settings.encoding": "字符集",
  "settings.enterKey": "Enter 键",
  "settings.backspaceKey": "Backspace 键",
  "settings.fontSize": "字号",
  "settings.scrollback": "回滚行数",
  "settings.timestamp": "时间戳",
  "settings.timestamp.detail": "新会话默认显示行时间戳",
  "settings.logMode": "日志模式",
  "settings.logMode.raw": "原始字节",
  "settings.logMode.text": "可读文本",
  "settings.autoLog": "自动日志",
  "settings.autoLog.detail": "新会话连接后自动开始日志",
  "settings.diagnostics.title": "本地诊断",
  "settings.diagnostics.subtitle":
    "记录连接、日志和文件传输状态，不记录终端收发内容或凭据。",
  "settings.diagnostics.count": "当前保留 {count} / 500 条结构化事件",
  "settings.diagnostics.export": "导出诊断",
  "settings.diagnostics.clear": "清空诊断",
  "settings.cancel": "取消",
  "settings.save": "保存应用设置",
  "settings.error.fontSize": "默认字号必须是 8–40 的整数。",
  "settings.error.scrollback": "默认回滚行数必须是 0–2,000,000 的整数。",
} as const;

type TranslationKey = keyof typeof zhCN;

const enUS: Record<TranslationKey, string> = {
  "settings.title": "Application Settings",
  "settings.subtitle": "Application defaults apply only to new sessions.",
  "settings.close": "Close application settings",
  "settings.appearance.title": "Appearance & Behavior",
  "settings.appearance.subtitle":
    "Control application display and safety confirmations.",
  "settings.language": "Interface language",
  "settings.language.zh": "简体中文",
  "settings.language.en": "English",
  "settings.theme": "Theme",
  "settings.theme.light": "Light",
  "settings.theme.dark": "Dark",
  "settings.theme.system": "Use system setting",
  "settings.closeConfirmation": "Close confirmation",
  "settings.closeConfirmation.detail":
    "Confirm before closing an active session or quitting",
  "settings.defaults.title": "New Session Defaults",
  "settings.defaults.subtitle":
    "Settings saved in a session always override these defaults.",
  "settings.defaultProtocol": "Default protocol",
  "settings.protocol.serial": "Serial",
  "settings.protocol.ssh": "SSH",
  "settings.protocol.adb": "ADB Shell",
  "settings.encoding": "Encoding",
  "settings.enterKey": "Enter key",
  "settings.backspaceKey": "Backspace key",
  "settings.fontSize": "Font size",
  "settings.scrollback": "Scrollback lines",
  "settings.timestamp": "Timestamp",
  "settings.timestamp.detail": "Show line timestamps in new sessions",
  "settings.logMode": "Log mode",
  "settings.logMode.raw": "Raw bytes",
  "settings.logMode.text": "Readable text",
  "settings.autoLog": "Automatic logging",
  "settings.autoLog.detail": "Start logging when a new session connects",
  "settings.diagnostics.title": "Local Diagnostics",
  "settings.diagnostics.subtitle":
    "Records connection, logging, and file transfer state without terminal data or credentials.",
  "settings.diagnostics.count":
    "{count} / 500 structured events currently retained",
  "settings.diagnostics.export": "Export diagnostics",
  "settings.diagnostics.clear": "Clear diagnostics",
  "settings.cancel": "Cancel",
  "settings.save": "Save application settings",
  "settings.error.fontSize": "Default font size must be an integer from 8 to 40.",
  "settings.error.scrollback":
    "Default scrollback must be an integer from 0 to 2,000,000.",
};

export function createTranslator(locale: AppLocale): Translator {
  const messages = locale === "en-US" ? enUS : zhCN;
  return (key, values = {}) =>
    Object.entries(values).reduce(
      (message, [name, value]) =>
        message.replaceAll(`{${name}}`, String(value)),
      messages[key],
    );
}

export function resolveLocale(
  locale: AppLocale,
  _browserLanguage: string,
): AppLocale {
  return locale;
}

interface I18nContextValue {
  locale: AppLocale;
  t: Translator;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "zh-CN",
  t: createTranslator("zh-CN"),
});

export function I18nProvider({
  locale,
  children,
}: {
  locale: AppLocale;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ locale, t: createTranslator(locale) }),
    [locale],
  );
  return (
    <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
