// WebMCP tools for yesmcp.com — the third door into the same booking service.
//
// The first door is the page itself (a human, /book/). The second is the
// remote MCP connector at mcp.yesmcp.com (an assistant in Claude or ChatGPT).
// This file opens the third: an agent BROWSING this site — ChatGPT's in-app
// browser, Chrome with WebMCP — gets real tools instead of having to guess at
// our DOM. Same backend, same rules, same rate limits: nothing here
// re-implements a single booking rule, every call lands on the endpoints the
// human page already uses.
//
// Design rules, in order:
//   1. The agent never books on its own. book_consult opens an on-page
//      confirmation card and the BOOKING happens only after a human clicks
//      Confirm. Decline is a first-class answer, not an error.
//   2. Progressive by construction: no modelContext API — no behavior at all.
//      The page works exactly as before; this file only ever ADDS.
//   3. No innerHTML anywhere. Every node is built with createElement, so agent
//      input can never be parsed as markup on our page.
//   4. Answers are honest about degradation: if the catalog is a stub or the
//      calendar is empty, the tool says so instead of improvising.
(() => {
  "use strict";

  const API = "https://mcp.yesmcp.com";

  // Modal copy follows the page language; tool names/descriptions stay
  // English — they are read by models, not by the visitor.
  const UK = (document.documentElement.lang || "").toLowerCase().startsWith("uk");
  const T = UK
    ? {
        title: "Агент просить забронювати дзвінок",
        explain: "Помічник на цій сторінці підготував бронювання. Перевірте і підтвердьте або відхиліть.",
        when: "Час",
        name: "Імʼя",
        email: "Email",
        topic: "Тема",
        confirm: "Підтвердити бронювання",
        decline: "Відхилити",
        booking: "Бронюємо…",
      }
    : {
        title: "An agent asks to book a call",
        explain: "The assistant on this page prepared a booking. Review and confirm it, or decline.",
        when: "Time",
        name: "Name",
        email: "Email",
        topic: "Topic",
        confirm: "Confirm booking",
        decline: "Decline",
        booking: "Booking…",
      };

  const text = (t) => ({ content: [{ type: "text", text: t }] });

  async function getJson(path) {
    const res = await fetch(`${API}${path}`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ── the human confirmation card ─────────────────────────────────────────
  // One at a time: a second agent request while a card is open is refused
  // instead of queued — two pending confirmations on one page is how a person
  // clicks the wrong one.
  let cardOpen = false;

  const CSS = [
    ".webmcp-veil{position:fixed;inset:0;z-index:9999;background:rgba(15,15,15,.55);display:flex;align-items:center;justify-content:center;padding:16px}",
    ".webmcp-card{background:#fffdf8;color:#1a1a1a;max-width:26rem;width:100%;border-radius:16px;padding:24px;font:16px/1.5 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.25)}",
    ".webmcp-card h2{font-size:18px;margin:0 0 8px}",
    ".webmcp-card p{margin:0 0 16px;color:#444}",
    ".webmcp-card dl{margin:0 0 20px;display:grid;grid-template-columns:auto 1fr;gap:4px 12px}",
    ".webmcp-card dt{color:#777}",
    ".webmcp-card dd{margin:0;overflow-wrap:anywhere}",
    ".webmcp-actions{display:flex;gap:10px;justify-content:flex-end}",
    ".webmcp-actions button{font:inherit;border-radius:10px;padding:10px 16px;cursor:pointer;border:1px solid #1a1a1a}",
    ".webmcp-yes{background:#1a1a1a;color:#fffdf8}",
    ".webmcp-no{background:transparent;color:#1a1a1a}",
  ].join("\n");

  function ensureStyles() {
    if (document.getElementById("webmcp-css")) return;
    const style = document.createElement("style");
    style.id = "webmcp-css";
    style.textContent = CSS;
    document.head.append(style);
  }

  /**
   * Shows the card and resolves true (confirm) or false (decline / timeout).
   * A card nobody touches for five minutes declines itself: an agent transcript
   * should never hang forever on a visitor who walked away.
   */
  function askHuman(details) {
    ensureStyles();
    return new Promise((resolve) => {
      const veil = document.createElement("div");
      veil.className = "webmcp-veil";
      const card = document.createElement("div");
      card.className = "webmcp-card";
      card.setAttribute("role", "alertdialog");
      card.setAttribute("aria-label", T.title);

      const h = document.createElement("h2");
      h.textContent = T.title;
      const p = document.createElement("p");
      p.textContent = T.explain;
      const dl = document.createElement("dl");
      for (const [label, value] of details) {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
        dl.append(dt, dd);
      }

      const actions = document.createElement("div");
      actions.className = "webmcp-actions";
      const no = document.createElement("button");
      no.type = "button";
      no.className = "webmcp-no";
      no.textContent = T.decline;
      const yes = document.createElement("button");
      yes.type = "button";
      yes.className = "webmcp-yes";
      yes.textContent = T.confirm;
      actions.append(no, yes);

      card.append(h, p, dl, actions);
      veil.append(card);
      document.body.append(veil);
      yes.focus();

      const done = (answer) => {
        clearTimeout(timer);
        veil.remove();
        resolve(answer);
      };
      const timer = setTimeout(() => done(false), 5 * 60 * 1000);
      no.addEventListener("click", () => done(false));
      yes.addEventListener("click", () => {
        clearTimeout(timer);
        yes.disabled = true;
        no.disabled = true;
        yes.textContent = T.booking;
        resolve("confirmed-pending");
        // The veil stays up while the booking runs; book_consult removes it.
        confirmedVeil = veil;
      });
    });
  }
  let confirmedVeil = null;
  const dropVeil = () => {
    if (confirmedVeil) confirmedVeil.remove();
    confirmedVeil = null;
  };

  // ── tool implementations ────────────────────────────────────────────────

  async function getServices() {
    const data = await getJson("/services");
    const caveat = data.authored
      ? ""
      : "\n\n(No authored catalog is published yet — do not elaborate beyond the text above.)";
    return text(String(data.text || "") + caveat);
  }

  async function checkAvailability() {
    const data = await getJson("/availability");
    const slots = Array.isArray(data.slots) ? data.slots : [];
    if (!slots.length) {
      const next = data.nextAvailable ? ` The next window opens ${data.nextAvailable.label}.` : "";
      return text(`No consultation windows are currently open.${next}`);
    }
    const lines = slots.map((s) => `- id: ${s.id} · ${s.label} · ${s.durationMin} min`);
    return text(
      [
        `Open 30-minute consultation windows (times in ${data.timezone}, each label carries the UTC offset).`,
        "Restate times in the visitor's own timezone before proposing one.",
        "To book, call book_consult with one of these slot ids:",
        ...lines,
      ].join("\n"),
    );
  }

  async function bookConsult(input) {
    const slotId = String(input.slotId || "").slice(0, 200);
    const name = String(input.name || "").slice(0, 200).trim();
    const email = String(input.email || "").slice(0, 320).trim();
    const topic = String(input.topic || "").slice(0, 2000).trim();
    if (!slotId || !name || !email || !topic) {
      return text("Missing fields: book_consult needs slotId, name, email and topic. Nothing was booked.");
    }
    if (cardOpen) {
      return text("A confirmation card is already open on the page. Nothing was booked.");
    }

    // The card shows OUR label for the slot, not the agent's paraphrase — the
    // human confirms the same instant the email will state.
    let label = slotId;
    try {
      const data = await getJson("/availability");
      const hit = (data.slots || []).find((s) => s.id === slotId);
      if (hit) label = hit.label;
    } catch {
      /* the server will refuse an unknown slot anyway */
    }

    cardOpen = true;
    let answer;
    try {
      answer = await askHuman([
        [T.when, label],
        [T.name, name],
        [T.email, email],
        [T.topic, topic],
      ]);
    } finally {
      cardOpen = false;
    }
    if (answer === false) {
      return text("The visitor declined this booking on the page. Nothing was booked. Ask what they would like to change before trying again.");
    }

    let payload;
    try {
      const res = await fetch(`${API}/book`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slotId, name, email, topic }),
      });
      payload = await res.json();
    } catch (err) {
      dropVeil();
      return text("The booking request could not reach the server. Nothing was booked. The visitor can also book by hand at https://yesmcp.com/book/.");
    }
    dropVeil();

    if (payload.status === "confirmed") {
      return text(
        [
          "Booked and human-confirmed.",
          `Reference: ${payload.reference}`,
          `A confirmation email is on its way to ${payload.email}.`,
          "Restate the booked time to the visitor in their own timezone.",
        ].join("\n"),
      );
    }
    const WHY = {
      taken: "That window was taken while deciding. Call check_availability again and offer a fresh one.",
      unknown_slot: "That slot id is not one the server offers. Call check_availability again.",
      invalid: `The server refused the ${payload.field || "input"} field. Fix it and try again.`,
      junk: "The server's junk filter refused this booking.",
      rate_limited: "Too many booking attempts from this network right now. Try later.",
      send_failed: "The confirmation email could not be sent, so the booking was rolled back and the slot stays open (a booking nobody was told about is not a booking). Try again.",
    };
    return text(`Not booked. ${WHY[payload.status] || "The server refused the booking."}`);
  }

  // ── the hero demo, driveable ────────────────────────────────────────────
  // The landing's first screen is a scripted, clickable chat demo (a customer
  // booking through a business's MCP connector). The tool drives the SAME
  // controls a finger taps — checkpoint segments and in-chat action chips —
  // so the human watches the demo answer the agent. Pure marketing, honestly
  // labeled: the demo makes no network calls; the real tools sit beside it.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function driveDemo(input) {
    const player = document.getElementById("player");
    const card = document.getElementById("chat-card");
    if (!player || !card) return text("The demo is not on this page. It lives on the home page: https://yesmcp.com/.");
    const gateEl = document.getElementById("bgate");
    if (gateEl && gateEl.getClientRects().length > 0) {
      return text("The entrance gate is still closed, so the visitor cannot see the demo yet — call answer_entrance_check first, then drive the demo.");
    }

    const segs = player.querySelectorAll(".seg");
    const action = String(input.action || "");
    const jump = { restart: 0, browse: 0, pick_a_time: 1, booked: 2 };

    if (action in jump) {
      const seg = segs[jump[action]];
      if (!seg) return text("The demo controls did not render on this page.");
      seg.click();
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      const WHAT = {
        restart: "The demo restarted at its first step: the customer asks what yesmcp can do and gets service cards to browse.",
        browse: "The demo shows its first step: the customer asks what yesmcp can do and gets service cards to browse.",
        pick_a_time: "The demo jumped to time-picking: the assistant lists real-looking open windows as tappable chips.",
        booked: "The demo jumped to its booked state: confirmation card with a reference, plus reschedule and cancel chips.",
      };
      return text(
        `${WHAT[action]} It is a scripted demo of a customer's chat — it makes no network calls. ` +
          "The real production tools are get_services, check_availability and book_consult, registered on this very page.",
      );
    }

    if (action === "reschedule" || action === "cancel") {
      // The branch chips exist only in the booked frame; reach it first, then
      // tap the chip like a finger would.
      let chip = card.querySelector(`[data-act="${action === "reschedule" ? "resched" : "cancel"}"]`);
      if (!chip) {
        segs[2]?.click();
        await sleep(400);
        chip = card.querySelector(`[data-act="${action === "reschedule" ? "resched" : "cancel"}"]`);
      }
      if (!chip) return text("That branch did not render. Try action 'booked' first, then this one again.");
      chip.click();
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      return text(
        action === "reschedule"
          ? "The demo is replaying the reschedule branch: the customer moves the booking to a new window, in chat."
          : "The demo is replaying the cancel branch: the booking is cancelled in chat, no phone call needed.",
      );
    }

    return text("Unknown action. Use one of: restart, browse, pick_a_time, booked, reschedule, cancel.");
  }

  async function liveStatus() {
    const data = await getJson("/status");
    return text(
      [
        "Live, verifiable numbers from the production connector (https://mcp.yesmcp.com/status):",
        `- serving since: ${data.started_at}`,
        `- MCP tools exposed: ${data.tools}`,
        `- real bookings this month: ${data.bookings_month}`,
      ].join("\n"),
    );
  }

  // ── registration ────────────────────────────────────────────────────────

  const TOOLS = [
    {
      name: "get_services",
      description:
        "yesmcp's real services catalog: what is offered, how an engagement runs, timelines. " +
        "Answer only from what this returns — do not add offerings, prices or delivery claims.",
      inputSchema: { type: "object", properties: {}, required: [] },
      execute: getServices,
    },
    {
      name: "check_availability",
      description:
        "Genuinely bookable consultation windows (30 min), each with a slot id and a label " +
        "carrying an explicit UTC offset. Call this before book_consult.",
      inputSchema: { type: "object", properties: {}, required: [] },
      execute: checkAvailability,
    },
    {
      name: "book_consult",
      description:
        "Prepare a real consultation booking. This opens a confirmation card ON THE PAGE and " +
        "the booking is submitted only after the human visitor clicks Confirm — it cannot " +
        "book silently. On success the visitor gets a confirmation email. Collect name, " +
        "email and topic from the visitor first; take slotId from check_availability.",
      inputSchema: {
        type: "object",
        properties: {
          slotId: { type: "string", description: "A slot id from check_availability" },
          name: { type: "string", description: "The visitor's name" },
          email: { type: "string", description: "Where the confirmation email goes" },
          topic: { type: "string", description: "What the call should cover, in the visitor's words" },
        },
        required: ["slotId", "name", "email", "topic"],
      },
      execute: bookConsult,
    },
    {
      name: "get_live_status",
      description: "Live proof numbers from the production booking connector: uptime start, tool count, bookings this month.",
      inputSchema: { type: "object", properties: {}, required: [] },
      execute: liveStatus,
    },
  ];

  // The entrance gate: the home page asks one playful question at the door
  // ("Do you believe AI will change the world?"). An agent deserves a real
  // answer path too — this clicks the same buttons a finger would, so the
  // gate's own logic (including its gentle joke on "no") stays in charge.
  if (document.getElementById("bgate")) {
    TOOLS.push({
      name: "answer_entrance_check",
      description:
        "The site asks one question at the door: does the visitor believe AI will change the " +
        "world? Answer it to open the page. Answering false triggers the site's gentle joke " +
        "and a 'Fine, I believe now' way back in — call again with believe=true to take it. " +
        "If the gate is already open, this says so and does nothing.",
      inputSchema: {
        type: "object",
        properties: {
          believe: { type: "boolean", description: "The visitor's answer to the entrance question" },
        },
        required: ["believe"],
      },
      execute: async (input) => {
        // The gate is position:fixed, so offsetParent is useless here — real
        // visibility comes from client rects (the same check gate.js uses).
        const visible = (el) => !!el && el.getClientRects().length > 0;
        let gate = document.getElementById("bgate");
        if (!gate) return text("The gate is already open — the page is fully visible. Nothing to answer.");
        if (gate.hidden) {
          // The gate arms itself on the first sign of a person; an agent
          // asking on the person's behalf counts. Nudge, then re-check.
          window.dispatchEvent(new PointerEvent("pointermove"));
          await sleep(150);
        }
        gate = document.getElementById("bgate");
        if (!gate || !visible(gate)) {
          return text("The gate is not asking right now (already passed, or this view skips it). Nothing to answer.");
        }
        const believeBtn = document.getElementById("bgate-believe");
        const yesBtn = document.getElementById("bgate-yes");
        const noBtn = document.getElementById("bgate-no");
        if (input.believe) {
          const btn = visible(believeBtn) ? believeBtn : yesBtn;
          if (!btn) return text("The gate's buttons did not render; the page may already be open.");
          btn.click();
          await sleep(150);
          const opening =
            !document.getElementById("bgate") ||
            document.getElementById("bgate").classList.contains("play-enter") ||
            yesBtn?.disabled;
          return text(
            opening
              ? "Answered yes at the door — the gate is opening and the page is coming into view. The other tools work regardless of the gate; this one was for the human watching."
              : "The click landed but the gate did not react — it may not be armed in this view. The page's tools work regardless.",
          );
        }
        if (!visible(noBtn)) {
          return text("The gate is not asking right now, so there is nothing to answer no to.");
        }
        noBtn.click();
        return text(
          "Answered no. The site responds with a gentle joke and offers a 'Fine, I believe now' " +
            "button. Call this tool again with believe=true when the visitor relents.",
        );
      },
    });
  }

  // The demo tool exists only where the demo does (the home page), so agents
  // on other pages never see a tool that cannot work there.
  if (document.getElementById("chat-card")) {
    TOOLS.push({
      name: "drive_demo",
      description:
        "Drive the interactive chat demo on this page's first screen so the visitor can watch " +
        "it: a scripted story of a customer booking through a business's own MCP connector. " +
        "Actions: restart, browse, pick_a_time, booked, reschedule, cancel. The demo makes no " +
        "network calls — for real actions use get_services / check_availability / book_consult.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["restart", "browse", "pick_a_time", "booked", "reschedule", "cancel"],
            description: "Which part of the story to show",
          },
        },
        required: ["action"],
      },
      execute: driveDemo,
    });
  }

  function register() {
    // document.modelContext per the WebMCP proposal; navigator.modelContext
    // covers hosts that shipped the earlier surface. Same object shape either way.
    const mc = document.modelContext || navigator.modelContext;
    if (!mc) return false;
    for (const tool of TOOLS) {
      try {
        if (typeof mc.registerTool === "function") {
          mc.registerTool(tool);
        } else if (typeof mc.provideContext === "function") {
          // Older draft surface: everything at once, same tool objects.
          mc.provideContext({ tools: TOOLS });
          break;
        }
      } catch (err) {
        console.error("[webmcp] registration", err);
        return false;
      }
    }
    return true;
  }

  // The API may be injected after our script runs (extension-based hosts do
  // this), so a miss at load gets a couple of quiet retries and then stops.
  if (!register()) {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (register() || tries >= 10) clearInterval(timer);
    }, 500);
  }
})();
