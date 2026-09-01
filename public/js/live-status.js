// Live numbers for the Proof section.
//
// Contract (docs/plans/2026-08-25-hero-widget-stories.md):
//   GET https://mcp.yesmcp.com/status  (public, no auth, CORS for yesmcp.com)
//   {"started_at":"YYYY-MM-DD","tools":9,"bookings_month":N,
//    "last_booking_day":"YYYY-MM-DD"}
//
// Honesty rules baked in:
//   - if the endpoint is unreachable or answers something we do not recognise,
//     the server-rendered fallback text stays exactly as it is; we never
//     invent, zero out or half-fill a number;
//   - a field missing from the payload leaves its slot untouched;
//   - the failure is logged to the console, never swallowed silently.
//
// Locale strings come from the markup (data-today / data-yesterday, the day
// count noun is built by Intl from <html lang>), never from this file.

const slots = [...document.querySelectorAll("[data-live]")];

if (slots.length) {
  const lang = document.documentElement.lang || "en";
  const pick = (key) => slots.find((el) => el.dataset.live === key);

  const startOfDay = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const parseDay = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const d = new Date(value + "T00:00:00Z");
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const daysSince = (day) =>
    Math.max(0, Math.round((startOfDay(new Date()) - startOfDay(day)) / 86400000));

  function paintCount(key, value) {
    const el = pick(key);
    if (!el || typeof value !== "number" || !Number.isFinite(value) || value < 0) return;
    el.textContent = String(Math.round(value));
    return true;
  }

  // rows that are hidden until the live endpoint confirms a non-empty value:
  // the static page never claims a number nobody can check
  function reveal(key) {
    document.querySelector('[data-live-row="' + key + '"]')?.removeAttribute("hidden");
  }

  // "last booking via chat: today" / a short date for anything older
  function paintLastBooking(lastDay) {
    const el = pick("lastbooking");
    const day = parseDay(lastDay);
    if (!el || !day) return;
    const diff = daysSince(day);
    if (diff === 0 && el.dataset.today) {
      el.textContent = el.dataset.today;
      return;
    }
    if (diff === 1 && el.dataset.yesterday) {
      el.textContent = el.dataset.yesterday;
      return;
    }
    el.textContent = new Intl.DateTimeFormat(lang, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(day);
  }

  // The launch date in the strip is written into the markup and never touched
  // from here: it is a fixed historical fact, not a live number.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);

  fetch("https://mcp.yesmcp.com/status", {
    signal: ctl.signal,
    headers: { accept: "application/json" },
  })
    .then((res) => {
      if (!res.ok) throw new Error("status " + res.status);
      return res.json();
    })
    .then((data) => {
      if (!data || typeof data !== "object") throw new Error("unexpected payload");
      paintCount("tools", data.tools);
      if (typeof data.bookings_month === "number" && data.bookings_month > 0) {
        paintCount("bookings", data.bookings_month);
        reveal("bookings");
      }
      if (parseDay(data.last_booking_day)) {
        paintLastBooking(data.last_booking_day);
        reveal("lastbooking");
      }
    })
    .catch((err) => {
      // static fallback stays on screen; the reason stays visible to us
      console.warn("[yesmcp] live status unavailable, showing fallback:", err);
    })
    .finally(() => clearTimeout(timer));
}
