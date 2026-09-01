// Walks /book/tg/ with a FAKE Telegram client injected, at 390px.
//
// Nothing real is contacted: telegram.org, GET /availability and POST /book are
// all intercepted. The POST interception is a hard safety rule, not a
// convenience — a real POST here would put a real booking in the owner's
// calendar. The route handler asserts it never sees a request it did not stub.
//
// The fake MainButton paints an actual bar at the bottom of the viewport,
// because a screenshot has to be able to show that the button is there and what
// it says. It is a test double for Telegram's native chrome, not page markup.
//
// Usage: node scripts/tg-miniapp-walk.mjs [outDir]

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const OUT = process.argv[2] || "/tmp/book-tg-shots";
const PORT = 4411;
const ROOT = new URL("..", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const AVAILABILITY = {
  timezone: "Europe/Warsaw",
  slots: [
    { id: "t:1", startUtc: "2026-09-01T08:00:00.000Z", durationMin: 30, label: "2026-09-01 10:00 CEST (UTC+2)" },
    { id: "t:2", startUtc: "2026-09-01T08:30:00.000Z", durationMin: 30, label: "2026-09-01 10:30 CEST (UTC+2)" },
    { id: "t:3", startUtc: "2026-09-02T12:00:00.000Z", durationMin: 30, label: "2026-09-02 14:00 CEST (UTC+2)" },
  ],
};

const DARK = {
  bg_color: "#17212b",
  secondary_bg_color: "#232e3c",
  text_color: "#f5f5f5",
  hint_color: "#708499",
  link_color: "#6ab3f3",
  button_color: "#5288c1",
  button_text_color: "#ffffff",
};
const LIGHT = {
  bg_color: "#ffffff",
  secondary_bg_color: "#f0f0f0",
  text_color: "#000000",
  hint_color: "#707579",
  link_color: "#3390ec",
  button_color: "#3390ec",
  button_text_color: "#ffffff",
};

function stubScript({ user, themeParams, colorScheme, initData }) {
  return `(() => {
    const calls = [];
    window.__tg = { calls, haptics: [] };
    const btnEl = document.createElement("div");
    const paint = () => {
      if (!document.body) return;
      if (!btnEl.isConnected) document.body.appendChild(btnEl);
      btnEl.style.cssText = "position:fixed;left:0;right:0;bottom:0;height:52px;display:" +
        (MainButton.isVisible ? "flex" : "none") +
        ";align-items:center;justify-content:center;font:600 15px system-ui;" +
        "background:" + ${JSON.stringify(themeParams.button_color)} + ";color:" +
        ${JSON.stringify(themeParams.button_text_color)} + ";z-index:99";
      btnEl.textContent = MainButton.isProgressVisible ? MainButton.text + " …" : MainButton.text;
      btnEl.setAttribute("data-testid", "tg-main-button");
    };
    const MainButton = {
      text: "", isVisible: false, isProgressVisible: false, _click: null,
      setText(t) { this.text = t; calls.push(["setText", t]); paint(); return this; },
      show() { this.isVisible = true; calls.push(["show"]); paint(); return this; },
      hide() { this.isVisible = false; calls.push(["hide"]); paint(); return this; },
      showProgress() { this.isProgressVisible = true; calls.push(["showProgress"]); paint(); return this; },
      hideProgress() { this.isProgressVisible = false; calls.push(["hideProgress"]); paint(); return this; },
      onClick(fn) { this._click = fn; calls.push(["onClick"]); return this; },
    };
    window.__tgClickMain = () => MainButton._click && MainButton._click();
    window.Telegram = { WebApp: {
      initData: ${JSON.stringify(initData)},
      initDataUnsafe: ${JSON.stringify(user ? { user } : {})},
      version: "7.0",
      colorScheme: ${JSON.stringify(colorScheme)},
      themeParams: ${JSON.stringify(themeParams)},
      viewportStableHeight: 780,
      MainButton,
      HapticFeedback: { notificationOccurred(t) { window.__tg.haptics.push(t); } },
      ready() { calls.push(["ready"]); },
      expand() { calls.push(["expand"]); },
      onEvent(name) { calls.push(["onEvent", name]); },
    } };
    document.addEventListener("DOMContentLoaded", paint);
  })();`;
}

const UK_INIT = "query_id=AAA&user=%7B%22id%22%3A42%7D&auth_date=1756300000&hash=deadbeef";
const EN_INIT = "query_id=BBB&user=%7B%22id%22%3A43%7D&auth_date=1756300001&hash=cafebabe";

async function main() {
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: `${ROOT}dist`,
    stdio: "ignore",
  });
  await sleep(700);

  const browser = await chromium.launch();
  const results = [];
  let realPostAttempts = 0;

  const openPage = async (init) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
    // Hard fence. Anything at mcp.yesmcp.com or telegram.org is answered here.
    // Playwright matches the MOST RECENTLY registered route first, so the
    // catch-all deny goes on first and the two stubs override it.
    await ctx.route("https://mcp.yesmcp.com/**", (r) => r.abort());
    await ctx.route("https://telegram.org/**", (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: "/* stubbed */" }));
    await ctx.route("https://mcp.yesmcp.com/availability", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(AVAILABILITY) }));
    await ctx.route("https://mcp.yesmcp.com/book", (r) => {
      realPostAttempts += 1;
      const body = JSON.parse(r.request().postData() || "{}");
      lastPost = body;
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "confirmed",
          reference: "YM-TEST-001",
          meetingUrl: "https://meet.example.com/ym-test",
          email: body.email,
        }),
      });
    });
    if (init) await ctx.addInitScript(stubScript(init));
    const page = await ctx.newPage();
    return { ctx, page };
  };

  let lastPost = null;

  // ── 1. Ukrainian user, dark theme ──────────────────────────────────────
  {
    const { ctx, page } = await openPage({
      user: { id: 42, first_name: "Оксана", last_name: "Коваль", username: "oksanak", language_code: "uk" },
      themeParams: DARK, colorScheme: "dark", initData: UK_INIT,
    });
    await page.goto(`http://127.0.0.1:${PORT}/book/tg/`, { waitUntil: "networkidle" });
    await page.waitForSelector("#book-picker:not(.hidden)");
    await page.screenshot({ path: `${OUT}/01-uk-dark-picker.png`, fullPage: true });
    await page.locator(".book-day-btn.has-slots").first().click();
    await page.locator(".slot").first().click();
    await page.waitForSelector("#book-form:not(.hidden)");
    const name = await page.inputValue("#book-name");
    await page.fill("#book-email", "oksana@example.com");
    await page.fill("#book-topic", "Хочемо запис на консультацію з телеграма.");
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/02-uk-dark-form-mainbutton.png`, fullPage: true });
    const tg = await page.evaluate(() => window.__tg.calls.map((c) => c.join(":")));
    const lang = await page.getAttribute("html", "lang");
    const paper = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const mbVisible = await page.locator('[data-testid="tg-main-button"]').isVisible();
    const mbText = await page.locator('[data-testid="tg-main-button"]').textContent();
    const stray = await page.locator('[data-lang="en"]').count();

    await page.evaluate(() => window.__tgClickMain());
    await page.waitForSelector("#book-done:not(.hidden)");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/03-uk-dark-confirmed.png`, fullPage: true });
    const haptics = await page.evaluate(() => window.__tg.haptics);
    const mbAfter = await page.locator('[data-testid="tg-main-button"]').isVisible();

    results.push({
      case: "uk user, dark themeParams",
      htmlLang: lang, prefilledName: name, bodyBackground: paper,
      strayEnglishBlocks: stray,
      mainButtonVisibleWhenValid: mbVisible, mainButtonText: mbText,
      mainButtonHiddenAfterConfirm: !mbAfter,
      haptics, postBody: lastPost,
      telegramCalls: tg.filter((c) => c.startsWith("ready") || c.startsWith("expand") || c.startsWith("onEvent")),
    });
    await ctx.close();
  }

  // ── 2. English user, light theme ───────────────────────────────────────
  {
    lastPost = null;
    const { ctx, page } = await openPage({
      user: { id: 43, first_name: "Marta", last_name: "Reid", username: "mreid", language_code: "en-GB" },
      themeParams: LIGHT, colorScheme: "light", initData: EN_INIT,
    });
    await page.goto(`http://127.0.0.1:${PORT}/book/tg/`, { waitUntil: "networkidle" });
    await page.waitForSelector("#book-picker:not(.hidden)");
    await page.locator(".book-day-btn.has-slots").first().click();
    await page.locator(".slot").first().click();
    await page.waitForSelector("#book-form:not(.hidden)");
    const name = await page.inputValue("#book-name");
    await page.fill("#book-email", "marta@example.com");
    await page.fill("#book-topic", "We want bookings straight from Telegram.");
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/04-en-light-form-mainbutton.png`, fullPage: true });
    const lang = await page.getAttribute("html", "lang");
    const mbText = await page.locator('[data-testid="tg-main-button"]').textContent();
    const stray = await page.locator('[data-lang="uk"]').count();
    await page.evaluate(() => window.__tgClickMain());
    await page.waitForSelector("#book-done:not(.hidden)");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/05-en-light-confirmed.png`, fullPage: true });
    results.push({
      case: "en user, light themeParams",
      htmlLang: lang, prefilledName: name, mainButtonText: mbText,
      strayUkrainianBlocks: stray,
      haptics: await page.evaluate(() => window.__tg.haptics),
      postBody: lastPost,
    });
    await ctx.close();
  }

  // ── 3. Plain browser, no Telegram at all ───────────────────────────────
  {
    const { ctx, page } = await openPage(null);
    await page.goto(`http://127.0.0.1:${PORT}/book/tg/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/06-plain-browser-fallback.png`, fullPage: true });
    results.push({
      case: "plain browser, no Telegram",
      fallbackVisible: await page.locator("#tg-fallback").isVisible(),
      fallbackText: (await page.locator("#tg-fallback").textContent()).trim().replace(/\s+/g, " "),
      pickerRemoved: (await page.locator("#book-app").count()) === 0,
      requestsToConnector: (await page.evaluate(() =>
        performance.getEntriesByType("resource").filter((r) => r.name.includes("mcp.yesmcp.com")).length)),
    });
    await ctx.close();
  }

  // ── 4. /book/ is untouched: no tgInitData on the plain web page ────────
  {
    lastPost = null;
    const { ctx, page } = await openPage(null);
    await page.goto(`http://127.0.0.1:${PORT}/book/`, { waitUntil: "networkidle" });
    await page.waitForSelector("#book-picker:not(.hidden)");
    await page.locator(".book-day-btn.has-slots").first().click();
    await page.locator(".slot").first().click();
    await page.fill("#book-name", "Web Visitor");
    await page.fill("#book-email", "web@example.com");
    await page.fill("#book-topic", "Booking from the plain web page.");
    await page.click("#book-submit");
    await page.waitForSelector("#book-done:not(.hidden)");
    results.push({ case: "/book/ regression", postBody: lastPost });
    await ctx.close();
  }

  await browser.close();
  server.kill();

  console.log(JSON.stringify({ postsIntercepted: realPostAttempts, results }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
