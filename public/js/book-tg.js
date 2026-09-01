// The Telegram Mini App wrapper around the booking page.
//
// It owns everything that is Telegram's and NOTHING that is the calendar's:
// book.js still loads the windows, groups them by zone, renders the month and
// posts the booking. This file only decides which language the page speaks,
// paints it in the colours the client handed us, prefills the name Telegram
// already knows, and hands the submit button to Telegram's MainButton. One
// calendar codebase, three doors.
//
// It runs BEFORE book.js (both are deferred, and deferred scripts execute in
// document order), so by the time book.js reads #book-app the locale and the
// string set are already the right ones.
//
// It keeps nothing in the browser: no storage, no cookie. The only third-party
// resource on this page is Telegram's own telegram-web-app.js, which is what
// makes it a Mini App at all.
(() => {
  "use strict";

  const html = document.documentElement;
  const root = document.getElementById("book-app");
  const wa = window.Telegram && window.Telegram.WebApp;
  const user = (wa && wa.initDataUnsafe && wa.initDataUnsafe.user) || null;

  // "Inside Telegram" is not "the script loaded": open this URL in a normal
  // browser and telegram-web-app.js still defines WebApp, with nothing in it.
  // What is missing there is exactly what we need, so that is what we test.
  const inTelegram = !!(wa && (wa.initData || user));

  // Telegram sends an IETF tag ("uk", "ru-RU", "en-GB"). Ukrainian and Russian
  // speakers get the Ukrainian page; everyone else gets the English one.
  const localeOf = (code) => (/^(uk|ru)\b/i.test(String(code || "").replace("_", "-")) ? "uk" : "en");
  const locale = localeOf(user ? user.language_code : navigator.language);

  // ── one page, two languages ─────────────────────────────────────────────
  function applyLocale(loc) {
    const other = loc === "uk" ? "en" : "uk";
    for (const el of document.querySelectorAll(`[data-lang="${other}"]`)) el.remove();
    for (const el of document.querySelectorAll("[data-en][data-uk]")) el.textContent = el.dataset[loc];
    for (const el of document.querySelectorAll("[data-ph-en][data-ph-uk]")) {
      el.setAttribute("placeholder", el.getAttribute(`data-ph-${loc}`));
    }
    for (const el of document.querySelectorAll("[data-aria-en][data-aria-uk]")) {
      el.setAttribute("aria-label", el.getAttribute(`data-aria-${loc}`));
    }
    // The language of the document is the language code, never the URL segment.
    html.lang = loc;
    if (root) {
      root.dataset.locale = loc;
      root.dataset.i18n = root.dataset[loc === "uk" ? "i18nUk" : "i18nEn"] || "{}";
    }
    html.classList.add("lang-ready");
  }

  applyLocale(locale);

  const T = root ? JSON.parse(root.dataset.i18n || "{}") : {};

  if (!inTelegram) {
    // An honest dead end beats a half-app: remove the picker's root so book.js
    // returns without asking anyone for anything, and point at the web page
    // that does work in a browser.
    if (root) root.remove();
    const note = document.getElementById("tg-fallback");
    if (note) note.classList.remove("hidden");
    return;
  }

  html.classList.add("tg-app");

  const els = {
    form: document.getElementById("book-form"),
    name: document.getElementById("book-name"),
    submit: document.getElementById("book-submit"),
    done: document.getElementById("book-done"),
  };

  // Telegram's API surface differs by client version; a missing method is a
  // fact about the client, not an error to throw at the visitor.
  const call = (obj, method, ...args) => {
    if (obj && typeof obj[method] === "function") {
      try {
        return obj[method](...args);
      } catch (err) {
        console.error(`[book-tg] ${method}`, err);
      }
    }
    return undefined;
  };

  call(wa, "ready");
  call(wa, "expand");

  // ── colour, from the client's theme rather than from ours ───────────────
  // Telegram hands over hex strings; we hand them to the same custom properties
  // @theme defines, so every utility on the page follows without a single
  // colour being picked here. Nothing is hardcoded: absent themeParams means
  // our own palette stands untouched.
  const rgb = (hex) => {
    const s = String(hex || "").trim().replace("#", "");
    if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(s)) return null;
    const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  const lum = (c) => {
    const f = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4));
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => {
    const [x, y] = [rgb(a), rgb(b)];
    if (!x || !y) return 0;
    const [l1, l2] = [lum(x), lum(y)];
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const token = (name) => getComputedStyle(html).getPropertyValue(name).trim();

  function applyTheme() {
    const p = (wa && wa.themeParams) || {};
    const set = (name, value) => {
      if (rgb(value)) html.style.setProperty(name, value);
    };

    const paper = rgb(p.bg_color) ? p.bg_color : null;
    if (!paper) return; // no theme from the client: our defaults stay.

    set("--color-paper", p.bg_color);
    set("--color-paper-deep", p.secondary_bg_color || p.bg_color);
    set("--color-ink", p.text_color);

    // Contrast is arithmetic, not trust. Telegram's hint colour is meant for
    // secondary text, but a custom theme can put it anywhere, and body text
    // under 4.5:1 is a defect whoever chose the colour. Below the line we fall
    // back to the full-strength text colour rather than shipping grey mush.
    const ink = rgb(p.text_color) ? p.text_color : token("--color-ink");
    const hint = p.hint_color;
    const soft = rgb(hint) && ratio(hint, paper) >= 4.5 ? hint : ink;
    set("--color-ink-soft", soft);
    set("--color-ink-faint", soft);

    // The accent carries links, the "confirmed" stamp and the focus ring. Our
    // deep green is measured against paper; on a dark surface it fails, and the
    // token that exists for exactly that case takes over. Both are ours.
    const deep = token("--color-yes-deep");
    const bright = token("--color-yes-bright");
    if (ratio(deep, paper) < 4.5) {
      const accent = ratio(bright, paper) >= 4.5 ? bright : p.link_color;
      if (rgb(accent) && ratio(accent, paper) >= 4.5) {
        html.style.setProperty("--color-yes-deep", accent);
        html.style.setProperty("--color-yes", accent);
      }
    }
  }

  applyTheme();
  call(wa, "onEvent", "themeChanged", applyTheme);

  // ── viewport ────────────────────────────────────────────────────────────
  // viewportStableHeight, not 100vh: the stable height is the one that does not
  // jump when the keyboard opens over the form.
  const setViewport = () => {
    const h = wa && wa.viewportStableHeight;
    if (typeof h === "number" && h > 0) html.style.setProperty("--tg-viewport", `${h}px`);
  };
  setViewport();
  call(wa, "onEvent", "viewportChanged", setViewport);

  // ── what Telegram already knows ─────────────────────────────────────────
  // The name, and only the name. The email stays empty and required, because
  // the confirmation email is the commitment: Telegram does not hand one over
  // and we would not want a guessed one.
  if (user && els.name && !els.name.value) {
    const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
    if (full) els.name.value = full;
  }

  // ── the field book.js posts on our behalf ───────────────────────────────
  // The one hook into the shared script: it asks for extra fields, we answer
  // with the raw initData so the connector can verify who is booking. On /book/
  // nothing defines this, so that request goes out byte-for-byte as before.
  window.bookExtraFields = () => (wa && wa.initData ? { tgInitData: wa.initData } : null);

  // ── MainButton instead of the in-form button ────────────────────────────
  const mb = wa && wa.MainButton;
  if (!mb || !els.form) return;

  call(mb, "setText", T.submit || "");

  const ready = () =>
    !els.form.classList.contains("hidden") &&
    (!els.done || els.done.classList.contains("hidden")) &&
    els.form.checkValidity();

  const sync = () => (ready() ? call(mb, "show") : call(mb, "hide"));

  call(mb, "onClick", () => {
    if (!ready()) return;
    if (typeof els.form.requestSubmit === "function") els.form.requestSubmit();
    else els.form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  });

  els.form.addEventListener("input", sync);
  els.form.addEventListener("change", sync);

  // book.js owns the states; we read them off the DOM it already writes rather
  // than teaching it about Telegram. The form appearing means a slot was
  // chosen; the submit button going disabled means a request is in flight; the
  // confirmation card appearing means it landed.
  new MutationObserver(sync).observe(els.form, { attributes: true, attributeFilter: ["class"] });

  if (els.submit) {
    new MutationObserver(() => {
      if (els.submit.disabled) call(mb, "showProgress");
      else call(mb, "hideProgress");
    }).observe(els.submit, { attributes: true, attributeFilter: ["disabled"] });
  }

  if (els.done) {
    new MutationObserver(() => {
      if (els.done.classList.contains("hidden")) return;
      call(mb, "hideProgress");
      call(mb, "hide");
      const haptic = wa.HapticFeedback;
      call(haptic, "notificationOccurred", "success");
    }).observe(els.done, { attributes: true, attributeFilter: ["class"] });
  }

  // book.js runs after this file and only then can the form exist in a state
  // worth reading, so take one look once the stack unwinds.
  setTimeout(sync, 0);
})();
