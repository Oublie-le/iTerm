import { expect, test, type Page } from "@playwright/test";

async function openVisualApp(page: Page, theme: "light" | "dark") {
  await page.addInitScript((initialTheme) => {
    localStorage.clear();
    localStorage.setItem(
      "iterm.preferences.v1",
      JSON.stringify({ locale: "zh-CN", theme: initialTheme }),
    );
  }, theme);
  await page.goto("/");
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        caret-color: transparent !important;
        transition: none !important;
      }
    `,
  });
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.getByText("CP2102 USB to UART", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", theme);
}

const screenshotOptions = {
  animations: "disabled" as const,
  caret: "hide" as const,
  maxDiffPixelRatio: 0.05,
  threshold: 0.25,
};

test("Apple 浅色工作区视觉基线", async ({ page }) => {
  await openVisualApp(page, "light");

  await expect(page).toHaveScreenshot(
    "apple-workspace-light.png",
    screenshotOptions,
  );
});

test("Apple 深色工作区视觉基线", async ({ page }) => {
  await openVisualApp(page, "dark");

  await expect(page).toHaveScreenshot(
    "apple-workspace-dark.png",
    screenshotOptions,
  );
});

test("Apple 会话色板编辑器视觉基线", async ({ page }) => {
  await openVisualApp(page, "light");
  await page.getByTitle("新建会话（Ctrl/⌘+N）").first().click();

  const session = page.getByRole("dialog", { name: "串口 会话设置" });
  await session
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "终端", exact: true })
    .click();
  await session.getByLabel("ANSI 调色板").selectOption("custom");
  await session
    .getByRole("region", { name: "自定义调色板" })
    .evaluate((element) => element.scrollIntoView({ block: "center" }));

  await expect(session).toHaveScreenshot(
    "apple-session-palette.png",
    screenshotOptions,
  );
});
