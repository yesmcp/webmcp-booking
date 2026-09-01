// Booking a call from the web, for people who do not have an AI chat open.
//
// Shape: a month calendar, a day, that day's times. It is the shape every
// scheduling page on the market uses, and the reason to copy it is that a
// visitor should not have to learn ours before they can pick a half-hour.
//
// One timezone rules the picker. The visitor's own by default, changeable
// through a native select. Everything the picker shows lives in that one zone,
// including which day a window belongs to: a window at 23:30 in Warsaw is the
// next morning in Tokyo, so the grouping is recomputed from the raw instant on
// every change and never cached against a zone that is no longer selected.
// Our own time appears exactly twice, where the meeting stops being browsed and
// starts being fixed: the summary above the form and the confirmation card.
// That line is what the email will say.
//
// One file serves both locales: every user-facing string arrives in the page's
// own markup (data-i18n), so a copy edit stays a copy edit and never becomes a
// second script that drifts from the first.
//
// It is an external file rather than an inline block on purpose: Astro inlines
// any <script> under 4 KB, and our CSP allows exactly one inline hash.
//
// Progressive by construction. Without JavaScript the page still explains how
// to reach us; this only ever ADDS the picker and the form. It keeps nothing in
// the browser: no storage, no cookie, no third party.
(() => {
  "use strict";

  const root = document.getElementById("book-app");
  if (!root) return;

  const API = root.dataset.endpoint;
  const T = JSON.parse(root.dataset.i18n || "{}");
  const LOCALE = root.dataset.locale || "en";

  const els = {
    status: document.getElementById("book-status"),
    picker: document.getElementById("book-picker"),
    month: document.getElementById("book-month"),
    prev: document.getElementById("book-prev"),
    next: document.getElementById("book-next"),
    grid: document.getElementById("book-grid"),
    head: document.getElementById("book-grid-head"),
    body: document.getElementById("book-grid-body"),
    tz: document.getElementById("book-tz"),
    dayHead: document.getElementById("book-day-head"),
    slots: document.getElementById("book-slots"),
    form: document.getElementById("book-form"),
    chosen: document.getElementById("book-chosen"),
    name: document.getElementById("book-name"),
    email: document.getElementById("book-email"),
    topic: document.getElementById("book-topic"),
    submit: document.getElementById("book-submit"),
    error: document.getElementById("book-error"),
    headDefault: document.getElementById("book-head"),
    headDone: document.getElementById("book-head-done"),
    done: document.getElementById("book-done"),
    fallback: document.getElementById("book-fallback"),
  };

  // ── state ───────────────────────────────────────────────────────────────
  // `slots` is the server's answer, untouched. Everything else is derived from
  // it plus the selected zone, so a zone change can never leave a stale view.
  const state = {
    slots: [],
    tz: "UTC",
    days: new Map(), // "YYYY-MM-DD" (in state.tz) -> [slot]
    months: [], // "YYYY-MM" that actually hold windows, ascending
    monthIndex: 0,
    day: null,
    chosen: null,
  };

  const show = (el, on) => el && el.classList.toggle("hidden", !on);
  const setStatus = (msg) => {
    if (els.status) els.status.textContent = msg || "";
  };

  // ── time, in one zone ───────────────────────────────────────────────────
  const fmt = (opts) => new Intl.DateTimeFormat(LOCALE, opts);

  // Which calendar day an instant falls on, IN the selected zone. Built from
  // parts rather than a locale string so no locale can reorder it on us.
  function dayKey(startUtc, tz) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(startUtc));
    const get = (type) => (parts.find((p) => p.type === type) || {}).value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  // A "YYYY-MM-DD" key back to a Date used only for NAMING the day. UTC noon
  // keeps the arithmetic clear of any zone: this date is a calendar label, not
  // an instant, and every formatter that touches it passes timeZone "UTC".
  const keyToDate = (key) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12));
  };

  const dayShort = (key) =>
    fmt({ timeZone: "UTC", weekday: "short", day: "numeric", month: "long" }).format(keyToDate(key));
  const dayLong = (key) =>
    fmt({ timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(keyToDate(key));
  const slotTime = (slot) =>
    fmt({ timeZone: state.tz, hour: "numeric", minute: "2-digit" }).format(new Date(slot.startUtc));

  // Some engines still hand back the pre-2022 IANA alias for Kyiv. It is the
  // same zone, and the value we pass to Intl stays whatever the engine gave us;
  // the old spelling is simply not one this brand prints on a page.
  const ZONE_ALIAS = { "Europe/Kiev": "Europe/Kyiv" };
  const zoneLabel = (zone) => (ZONE_ALIAS[zone] || zone).replace(/_/g, " ");

  const plural = (() => {
    let rules = null;
    try {
      rules = new Intl.PluralRules(LOCALE);
    } catch {
      rules = null;
    }
    return (n) => {
      const counts = T.count || {};
      const key = rules ? rules.select(n) : n === 1 ? "one" : "other";
      return `${n} ${counts[key] || counts.other || ""}`.trim();
    };
  })();

  // Our committed time next to theirs. Both readings, one line: this is the
  // sentence the confirmation email repeats.
  const bothTimes = (slot) =>
    `${dayLong(dayKey(slot.startUtc, state.tz))}, ${slotTime(slot)} (${zoneLabel(state.tz)}) · ${T.ourTime} ${slot.label}`;

  // ── deriving the calendar from the slots ────────────────────────────────
  function regroup() {
    const days = new Map();
    for (const slot of state.slots) {
      const key = dayKey(slot.startUtc, state.tz);
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(slot);
    }
    for (const list of days.values()) {
      list.sort((a, b) => new Date(a.startUtc) - new Date(b.startUtc));
    }
    state.days = days;
    state.months = [...new Set([...days.keys()].map((k) => k.slice(0, 7)))].sort();
  }

  const firstDayWithSlots = () => [...state.days.keys()].sort()[0] || null;
  const firstDayOfMonth = (month) =>
    [...state.days.keys()].sort().find((key) => key.startsWith(month)) || null;

  // Keep the visitor where they were. Their chosen window wins: if the zone
  // change moved it across midnight, the calendar follows the window rather
  // than leaving them staring at a day that no longer holds their booking.
  function reanchor() {
    if (state.chosen) state.day = dayKey(state.chosen.startUtc, state.tz);
    if (!state.day || !state.days.has(state.day)) state.day = state.months.length ? firstDayWithSlots() : null;
    const month = state.day ? state.day.slice(0, 7) : state.months[0];
    const index = state.months.indexOf(month);
    state.monthIndex = index < 0 ? 0 : index;
  }

  // ── rendering ───────────────────────────────────────────────────────────
  // replaceChildren, not innerHTML: nothing here ever parses a string as
  // markup, so the whole class of injection stays out of the file.
  function renderWeekdays() {
    const row = document.createElement("tr");
    // 2024-01-01 was a Monday, and the week starts Monday here.
    for (let i = 0; i < 7; i += 1) {
      const th = document.createElement("th");
      th.scope = "col";
      const date = new Date(Date.UTC(2024, 0, 1 + i, 12));
      th.textContent = fmt({ timeZone: "UTC", weekday: "short" }).format(date);
      th.setAttribute(
        "abbr",
        fmt({ timeZone: "UTC", weekday: "long" }).format(date),
      );
      row.append(th);
    }
    els.head.replaceChildren(row);
  }

  function renderMonth() {
    const month = state.months[state.monthIndex];
    if (!month) return;
    const [year, mon] = month.split("-").map(Number);
    els.month.textContent = fmt({ timeZone: "UTC", year: "numeric", month: "long" }).format(
      new Date(Date.UTC(year, mon - 1, 1, 12)),
    );

    els.prev.disabled = state.monthIndex <= 0;
    els.next.disabled = state.monthIndex >= state.months.length - 1;

    const first = new Date(Date.UTC(year, mon - 1, 1, 12));
    const lead = (first.getUTCDay() + 6) % 7; // Monday-first offset
    const length = new Date(Date.UTC(year, mon, 0, 12)).getUTCDate();
    const today = dayKey(new Date().toISOString(), state.tz);

    const rows = [];
    let row = document.createElement("tr");
    for (let i = 0; i < lead; i += 1) row.append(document.createElement("td"));

    for (let d = 1; d <= length; d += 1) {
      const key = `${month}-${String(d).padStart(2, "0")}`;
      const slots = state.days.get(key);
      const cell = document.createElement("td");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "book-day-btn";
      btn.textContent = String(d);

      if (slots && slots.length) {
        btn.classList.add("has-slots");
        btn.setAttribute("aria-pressed", key === state.day ? "true" : "false");
        btn.setAttribute("aria-label", `${dayShort(key)}, ${plural(slots.length)}`);
        btn.addEventListener("click", () => {
          state.day = key;
          state.chosen = null;
          show(els.form, false);
          renderMonth();
          renderDay();
        });
      } else {
        // A day with nothing open is not a target: disabled, not dimmed-clickable.
        btn.disabled = true;
        btn.setAttribute("aria-label", `${dayShort(key)}, ${T.noneOnDay}`);
      }

      if (key === today) btn.classList.add("is-today");
      cell.append(btn);
      row.append(cell);

      if ((lead + d) % 7 === 0) {
        rows.push(row);
        row = document.createElement("tr");
      }
    }
    if (row.childElementCount) {
      while (row.childElementCount < 7) row.append(document.createElement("td"));
      rows.push(row);
    }
    els.body.replaceChildren(...rows);
  }

  function renderDay() {
    els.slots.replaceChildren();
    if (!state.day) {
      els.dayHead.textContent = T.pickDay;
      return;
    }
    els.dayHead.textContent = dayLong(state.day);
    const slots = state.days.get(state.day) || [];
    if (!slots.length) {
      const empty = document.createElement("p");
      empty.className = "book-empty";
      empty.textContent = T.noneOnDay;
      els.slots.append(empty);
      return;
    }
    for (const slot of slots) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot";
      // One start time, in the one selected zone. No ranges, no second clock:
      // the second clock lives on the summary below, where it is a commitment.
      btn.textContent = slotTime(slot);
      btn.setAttribute("aria-pressed", state.chosen && state.chosen.id === slot.id ? "true" : "false");
      btn.addEventListener("click", () => choose(slot));
      els.slots.append(btn);
    }
  }

  function render() {
    renderMonth();
    renderDay();
  }

  function choose(slot) {
    state.chosen = slot;
    els.chosen.textContent = bothTimes(slot);
    renderDay();
    show(els.form, true);
    els.name.focus();
  }

  // ── the zone switch ─────────────────────────────────────────────────────
  function fillZones() {
    let zones = [];
    try {
      zones = Intl.supportedValuesOf("timeZone");
    } catch {
      zones = [];
    }
    if (!zones.includes(state.tz)) zones = [state.tz, ...zones];
    if (zones.length < 2) zones = [...new Set([state.tz, "UTC"])];
    els.tz.replaceChildren(
      ...zones.map((zone) => {
        const option = document.createElement("option");
        option.value = zone;
        option.textContent = zoneLabel(zone);
        if (zone === state.tz) option.selected = true;
        return option;
      }),
    );
    els.tz.addEventListener("change", () => {
      state.tz = els.tz.value;
      regroup();
      reanchor();
      render();
      // The chosen window did not move; the way we say it did.
      if (state.chosen) els.chosen.textContent = bothTimes(state.chosen);
    });
  }

  // ── loading ─────────────────────────────────────────────────────────────
  function apply(data) {
    state.slots = Array.isArray(data.slots) ? data.slots : [];
    if (!state.slots.length) {
      show(els.picker, false);
      setStatus(data.nextAvailable ? `${T.noneUntil} ${data.nextAvailable.label}` : T.noneAtAll);
      show(els.fallback, true);
      return;
    }
    setStatus("");
    regroup();
    reanchor();
    render();
    show(els.picker, true);
  }

  async function load() {
    setStatus(T.loading);
    try {
      const res = await fetch(`${API}/availability`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      apply(await res.json());
    } catch (err) {
      // An honest dead end beats a spinner: the page still carries the other
      // ways to reach us, so say the times could not be loaded and point there.
      console.error("[book] availability", err);
      show(els.picker, false);
      setStatus(T.loadFailed);
      show(els.fallback, true);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!state.chosen) return;
    els.error.textContent = "";
    els.submit.disabled = true;
    els.submit.textContent = T.sending;

    let payload;
    try {
      const res = await fetch(`${API}/book`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slotId: state.chosen.id,
          name: els.name.value,
          email: els.email.value,
          topic: els.topic.value,
          // A door that opens this page inside another app can attach its own
          // proof of who is asking; the Telegram Mini App at /book/tg/ attaches
          // its initData here. No hook, no field: on /book/ and /ua/book/ this
          // request goes out with exactly the three fields it always had.
          ...(typeof window.bookExtraFields === "function" ? window.bookExtraFields() : null),
        }),
      });
      payload = await res.json();
    } catch (err) {
      console.error("[book] submit", err);
      els.error.textContent = T.networkFailed;
      els.submit.disabled = false;
      els.submit.textContent = T.submit;
      return;
    }

    if (payload.status === "confirmed") {
      els.done.querySelector("[data-when]").textContent = els.chosen.textContent;
      els.done.querySelector("[data-ref]").textContent = payload.reference;
      const room = els.done.querySelector("[data-room]");
      // The URL comes from our own connector, but it lands in an href, and an
      // href is the one place where "our own" is not an argument: a scheme
      // check costs nothing and closes javascript: for good.
      const url = String(payload.meetingUrl || "");
      if (url.startsWith("https://")) {
        room.href = url;
        room.textContent = url;
      } else {
        room.removeAttribute("href");
        room.textContent = T.roomInEmail;
      }
      els.done.querySelector("[data-email]").textContent = payload.email;
      show(els.form, false);
      show(els.picker, false);
      show(els.done, true);
      // The second step of the page has to be USED: an invitation to pick a time
      // is nonsense to someone who just picked one. Both headers are in the
      // markup (so the Ukrainian page stays a translation); here we swap which
      // one is standing.
      show(els.headDefault, false);
      show(els.headDone, true);
      setStatus("");
      // Read the new heading first, the card second: the ask ("bring one
      // question") is the point now, the receipt is the footnote.
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    // Every refusal names what to do next; none of them leaves the person
    // guessing whether a booking happened.
    const MESSAGES = {
      invalid: () => T.invalid[payload.field] || T.invalidGeneric,
      junk: () => T.junk,
      rate_limited: () => T.rateLimited,
      taken: () => T.taken,
      unknown_slot: () => T.unknownSlot,
      send_failed: () => T.sendFailed,
    };
    els.error.textContent = (MESSAGES[payload.status] || (() => T.genericFailed))();
    els.submit.disabled = false;
    els.submit.textContent = T.submit;

    // A window that went while they were deciding: refresh the calendar so the
    // next click is against something that still exists.
    if (payload.status === "taken" || payload.status === "unknown_slot") {
      state.chosen = null;
      show(els.form, false);
      load();
    }
  }

  els.prev.addEventListener("click", () => {
    if (state.monthIndex <= 0) return;
    state.monthIndex -= 1;
    state.day = firstDayOfMonth(state.months[state.monthIndex]);
    state.chosen = null;
    show(els.form, false);
    render();
  });

  els.next.addEventListener("click", () => {
    if (state.monthIndex >= state.months.length - 1) return;
    state.monthIndex += 1;
    state.day = firstDayOfMonth(state.months[state.monthIndex]);
    state.chosen = null;
    show(els.form, false);
    render();
  });

  els.form.addEventListener("submit", submit);

  try {
    state.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    state.tz = "UTC";
  }
  fillZones();
  renderWeekdays();
  load();
})();
