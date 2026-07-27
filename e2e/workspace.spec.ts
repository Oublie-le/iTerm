import { expect, test, type Page } from "@playwright/test";

async function openFreshApp(page: Page, locale: "zh-CN" | "en-US" = "zh-CN") {
  await page.addInitScript((initialLocale) => {
    if (sessionStorage.getItem("iterm.e2e.initialized") === "true") return;
    sessionStorage.setItem("iterm.e2e.initialized", "true");
    localStorage.clear();
    if (initialLocale === "en-US") {
      localStorage.setItem(
        "iterm.preferences.v1",
        JSON.stringify({ locale: initialLocale }),
      );
    }
  }, locale);
  await page.goto("/");
}

test("切换语言并浏览完整会话设置", async ({ page }) => {
  await openFreshApp(page);

  await expect(page.getByLabel("iTerm")).toBeVisible();
  await expect(page.locator(".app-menubar")).toHaveCSS(
    "backdrop-filter",
    "none",
  );
  await expect(page.getByText("会话管理器", { exact: true })).toBeVisible();
  await page.getByTitle("应用设置").click();

  const settings = page.getByRole("dialog", { name: "应用设置" });
  await expect(settings).toBeVisible();
  await settings
    .locator("label")
    .filter({ hasText: "界面语言" })
    .locator("select")
    .selectOption("en-US");
  await settings.getByRole("button", { name: "保存应用设置" }).click();

  await expect(
    page.getByRole("button", { name: "Session", exact: true }),
  ).toBeVisible();
  await page.getByTitle("New session (Ctrl/⌘+N)").first().click();

  const session = page.getByRole("dialog", {
    name: "Serial Session Settings",
  });
  await expect(session).toBeVisible();

  const categories = session.getByRole("navigation", {
    name: "Settings categories",
  });
  for (const pageName of ["Terminal", "Window", "Logging", "Triggers"]) {
    await categories.getByRole("button", { name: pageName, exact: true }).click();
    await expect(
      session.getByRole("heading", { name: pageName, exact: true }),
    ).toBeVisible();
  }
});

test("发现本机 SSH 配置并填入连接别名", async ({ page }) => {
  await openFreshApp(page, "en-US");
  await page.getByTitle("New session (Ctrl/⌘+N)").first().click();

  const session = page.locator(".session-dialog");
  await session.getByLabel("Protocol").selectOption("ssh");
  await session
    .getByRole("navigation", { name: "Settings categories" })
    .getByRole("button", { name: "SSH", exact: true })
    .click();

  await expect(session.getByText("Local SSH Hosts")).toBeVisible();
  await expect(session.getByText("apple-lab", { exact: true })).toBeVisible();
  await expect(session.getByText("Key configured").first()).toBeVisible();
  await session.getByRole("button", { name: "Fill" }).first().click();

  await expect(
    session.getByRole("textbox", { name: "Host", exact: true }),
  ).toHaveValue("apple-lab");
  await expect(
    session.getByRole("textbox", { name: "Username", exact: true }),
  ).toHaveValue("developer");
  await session.getByRole("button", { name: "Cancel" }).click();
});

test("连接串口并操作工作区菜单", async ({ page }) => {
  await openFreshApp(page, "en-US");

  await expect(page.getByText("Available Devices", { exact: true })).toBeVisible();
  await expect(page.getByText("CP2102 USB to UART", { exact: true })).toBeVisible();
  await page.getByTitle("New session (Ctrl/⌘+N)").first().click();

  const session = page.getByRole("dialog", {
    name: "Serial Session Settings",
  });
  await session.getByLabel("Session name").fill("E2E Serial");
  await session.getByRole("button", { name: "Save & Connect" }).click();

  await expect(page.locator(".statusbar strong")).toHaveText("Connected", {
    timeout: 5_000,
  });
  await expect(
    page.getByRole("region", { name: "Sender pane" }),
  ).toBeVisible();

  const terminal = page.getByRole("region", {
    name: "E2E Serial terminal",
  });
  await terminal.click();
  await page.keyboard.press("Control+Shift+K");
  const commandInput = page.getByLabel("Command input");
  await commandInput.fill("help");
  await commandInput.press("Enter");
  await expect(
    page.locator(".terminal-history-list code").filter({ hasText: "help" }),
  ).toBeVisible();

  await terminal.click();
  await page.keyboard.press("Control+=");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const profiles = JSON.parse(
          localStorage.getItem("iterm.profiles.v1") ?? "[]",
        ) as Array<{ terminal?: { fontSize?: number } }>;
        return profiles[0]?.terminal?.fontSize;
      }),
    )
    .toBe(15);

  await terminal.click({ button: "right", position: { x: 220, y: 120 } });
  const contextMenu = page.getByRole("menu", { name: "Terminal actions" });
  await expect(contextMenu).toBeVisible();
  await expect(
    contextMenu.getByRole("menuitem", { name: /Paste/ }),
  ).toBeEnabled();
  await expect(
    contextMenu.getByRole("menuitem", { name: /Copy/ }),
  ).toBeDisabled();
  await contextMenu.getByRole("menuitem", { name: /Select All/ }).click();
  await expect(contextMenu).toBeHidden();

  await page.getByRole("button", { name: "Mode", exact: true }).click();
  await page
    .getByRole("menuitemcheckbox", { name: "Hex Receive" })
    .click();
  await expect(
    page.getByRole("region", { name: "Hex receive view" }),
  ).toBeVisible();

  await page.getByLabel("Tab list").click();
  await expect(
    page.getByRole("menuitem", { name: /E2E Serial.*Current/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "View", exact: true }).click();
  await page
    .getByRole("menuitemcheckbox", { name: "Sender Pane" })
    .click();
  await expect(
    page.getByRole("region", { name: "Sender pane" }),
  ).toBeHidden();

  await page.getByRole("button", { name: "Mode", exact: true }).click();
  await page
    .getByRole("menuitemcheckbox", { name: "Text Receive" })
    .click();
  await page.locator('.menu-actions button[title="Search"]').click();
  await expect(page.getByLabel("Find terminal content")).toBeVisible();
});

test("清除本地应用数据并恢复默认设置", async ({ page }) => {
  await openFreshApp(page, "en-US");
  await expect(
    page.getByText("CP2102 USB to UART", { exact: true }),
  ).toBeVisible();
  await page.getByTitle("New session (Ctrl/⌘+N)").first().click();
  await page
    .getByRole("dialog", { name: "Serial Session Settings" })
    .getByRole("button", { name: "Save & Connect" })
    .click();
  await expect(page.locator(".statusbar strong")).toHaveText("Connected");

  await page.getByTitle("Application settings").click();

  const settings = page.getByRole("dialog", {
    name: "Application Settings",
  });
  page.once("dialog", (dialog) => dialog.accept());
  await settings
    .getByRole("button", { name: "Clear local application data" })
    .click();

  await expect(page.getByText("会话管理器", { exact: true })).toBeVisible();
  await expect(page.locator(".session-tab")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => localStorage.getItem("iterm.preferences.v1") ?? "",
      ),
    )
    .not.toContain('"locale":"en-US"');
});
