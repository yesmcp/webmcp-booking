// Hero chat demo engine. Markup, styling and every visible string live in
// src/components/HeroChatStories.astro; this file only knows how a chat
// *behaves*: user turns pop, tool calls run and then resolve, assistant text
// streams, widgets arrive behind a skeleton.
//
// Loaded as a plain module from public/ (CSP script-src 'self', no inline).
// Locale strings reach the engine through the DOM: frame templates, the
// booked/moved verbs on the card's dataset, the slot value on [data-autopick].

const card = document.getElementById("chat-card");
const transcript = document.getElementById("transcript");
const player = document.getElementById("player");
const pauseBtn = document.getElementById("pause");
const composer = document.getElementById("composer");
const caption = document.getElementById("caption");

if (card && transcript && player && pauseBtn && composer && caption) {
  const segs = [...player.querySelectorAll(".seg")];
  const rm = matchMedia("(prefers-reduced-motion: reduce)");

  let step = 0; // last APPENDED step (0..2)
  let interacted = false; // user took over, autoplay off
  let finished = false;
  let userPaused = false;
  let inView = false;
  let warmedUp = false;
  let pending = 0; // step sequences still arriving
  let runSeg = -1; // segment whose fill is currently animating
  const settled = () => pending === 0; // "the step landed, you may read it"

  // Step 1 ships as real HTML so the frame survives without JS. Harvest it
  // into a template once, then treat it like every other frame.
  const step1Tpl = document.createElement("template");
  while (transcript.firstChild) step1Tpl.content.appendChild(transcript.firstChild);

  const frame = (id) => document.getElementById(id).content.cloneNode(true);
  const tpl = (id) => (id === "t-step1" ? step1Tpl.content.cloneNode(true) : frame(id));

  // the slot autoplay picks, and the confirmation verbs: locale strings, read
  // out of the markup rather than hard-coded here
  const autoSlot =
    document.getElementById("t-step2").content.querySelector("[data-autopick]").dataset.full;
  const verbBooked = card.dataset.verbBooked || "Booked";
  const verbMoved = card.dataset.verbMoved || verbBooked;

  // a stream holds while the demo is off-screen or the tab is hidden; hover
  // pause deliberately does NOT freeze it (a caret stuck mid-word reads broken)
  const streamHold = () => document.hidden || !inView;

  // ====================================================================
  // async sequencer: every step is a task on ONE serial queue, all of it
  // cancellable through a single AbortController. clearAppends() aborts
  // in-flight timers, rAF loops and streams, so seek can never leave an
  // orphan insert behind.
  // ====================================================================
  const ABORT = Symbol("abort");
  let ctl = new AbortController();
  let queue = Promise.resolve();

  function enqueue(task) {
    const signal = ctl.signal;
    queue = queue
      .then(() => (signal.aborted ? undefined : task(signal)))
      .catch((err) => {
        if (err !== ABORT) throw err;
      });
    return queue;
  }
  function delayed(ms, fn) {
    enqueue(async (signal) => {
      await sleep(ms, signal);
      fn();
    });
  }
  function clearAppends() {
    ctl.abort();
    ctl = new AbortController();
    queue = Promise.resolve();
    follows = 0;
    pending = 0;
  }
  function guard(signal) {
    if (signal.aborted) throw ABORT;
  }
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(ABORT);
        return;
      }
      const onAbort = () => {
        clearTimeout(t);
        reject(ABORT);
      };
      const t = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve(undefined);
      }, ms);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  const jitter = (base, spread) => base + Math.random() * spread;

  // ---- scroll: ONE rAF follower, alive only while something is arriving ----
  let follows = 0;
  let followId = 0;
  function scrollDown() {
    transcript.scrollTop = transcript.scrollHeight;
  }
  function startFollow() {
    follows++;
    if (followId) return;
    const tick = () => {
      scrollDown();
      followId = follows > 0 ? requestAnimationFrame(tick) : 0;
    };
    followId = requestAnimationFrame(tick);
  }
  function stopFollow() {
    if (follows > 0) follows--;
  }

  // ---- part builders ----
  function applyFills(parts, fills) {
    if (fills) {
      parts.forEach((p) =>
        p.querySelectorAll("[data-fill]").forEach((el) => {
          el.textContent = fills[el.dataset.fill] ?? el.textContent;
        }),
      );
    }
    return parts;
  }
  function append(node) {
    transcript.appendChild(node);
    scrollDown();
  }

  // "▸ yesmcp · list_availability(days: 2) ✓" → "yesmcp · list_availability"
  function toolName(finalText) {
    let t = finalText
      .trim()
      .replace(/^[▸⏺]\s*/, "")
      .replace(/\s*✓\s*$/, "");
    const cut = t.indexOf("(");
    if (cut > 0) t = t.slice(0, cut);
    return t.trim();
  }
  function makeToolRunning(name) {
    const row = document.createElement("div");
    row.className = "cl-toolrow cl-toolrun font-mono text-[11px] msg-pop";
    const dot = document.createElement("span");
    dot.className = "tool-dot";
    dot.textContent = "⏺";
    const label = document.createElement("span");
    label.className = "tool-shim";
    label.textContent = name + "…";
    row.append(dot, label);
    return row;
  }
  function makeSkeleton() {
    const box = document.createElement("div");
    box.className = "cl-widget cl-skel rounded-xl p-3 msg-pop";
    ["46%", "92%", "68%"].forEach((w) => {
      const bar = document.createElement("span");
      bar.className = "skel-bar";
      bar.style.width = w;
      box.appendChild(bar);
    });
    return box;
  }

  // ---- assistant text: real streaming (first-token delay, then rAF typing) ----
  async function streamText(el, signal) {
    const full = el.textContent ?? "";
    el.textContent = "";
    const text = document.createTextNode("");
    const caret = document.createElement("span");
    caret.className = "cl-caret";
    caret.textContent = "▍";
    el.append(text, caret);
    el.classList.add("msg-pop");
    append(el);

    // first-token delay, then rAF typing
    await sleep(jitter(400, 300), signal);
    return new Promise((resolve, reject) => {
      let i = 0;
      let last = performance.now();
      let budget = 0;
      let cps = jitter(34, 18); // 34–52 chars/s
      let raf = 0;
      const done = () => {
        signal.removeEventListener("abort", onAbort);
        caret.remove();
        resolve(undefined);
      };
      const onAbort = () => {
        cancelAnimationFrame(raf);
        reject(ABORT);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      const tick = () => {
        const now = performance.now();
        if (streamHold()) {
          last = now;
          raf = requestAnimationFrame(tick);
          return;
        }
        budget += ((now - last) / 1000) * cps;
        last = now;
        const left = full.length - i;
        if (budget >= 2 || (left > 0 && left <= 2 && budget > 0)) {
          // emit in small bursts (2–3 chars), reads like token chunks
          const burst = Math.min(Math.max(2, Math.floor(budget)), 3);
          budget -= burst;
          i = Math.min(full.length, i + burst);
          text.nodeValue = full.slice(0, i);
          if (Math.random() < 0.08) cps = jitter(34, 18); // light speed jitter
        }
        if (i >= full.length) {
          done();
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
  }

  // ---- one frame, played out with real chat pacing ----
  async function playParts(frag, fills, signal) {
    const parts = applyFills([...frag.children], fills);
    startFollow();
    try {
      for (const p of parts) {
        guard(signal);
        if (p.classList.contains("cl-bubble")) {
          // the user's own turn: it is already sent, so it just lands
          p.classList.add("msg-pop");
          append(p);
          await sleep(280, signal);
        } else if (p.classList.contains("cl-toolrow")) {
          const running = makeToolRunning(toolName(p.textContent ?? ""));
          append(running);
          await sleep(jitter(600, 300), signal);
          p.classList.add("fade-in");
          running.replaceWith(p);
          scrollDown();
          await sleep(200, signal);
        } else if (p.classList.contains("cl-text2")) {
          await streamText(p, signal);
          await sleep(140, signal);
        } else if (p.classList.contains("cl-widget")) {
          const skel = makeSkeleton();
          append(skel);
          await sleep(jitter(450, 150), signal);
          p.classList.add("fade-in");
          skel.replaceWith(p);
          scrollDown();
          await sleep(220, signal);
        } else {
          p.classList.add("msg-pop");
          append(p);
          await sleep(240, signal);
        }
      }
    } finally {
      stopFollow();
    }
  }

  function buildInstant(frag, fills) {
    applyFills([...frag.children], fills).forEach((p) => transcript.appendChild(p));
    scrollDown();
  }

  // A step is "settled" only once every part has arrived: the player fill
  // (= reading time) may not start before that.
  function runStep(instant, makeFrag, fills, onSettled) {
    if (instant || rm.matches) {
      buildInstant(makeFrag(), fills);
      paintPlayer();
      if (onSettled) onSettled();
      return;
    }
    pending++;
    paintPlayer();
    enqueue(async (signal) => {
      try {
        await playParts(makeFrag(), fills, signal);
      } finally {
        pending = Math.max(0, pending - 1);
      }
      paintPlayer();
      if (onSettled) onSettled();
    });
  }

  // ---- story steps ----
  function showStep1(instant) {
    step = 0;
    runStep(instant, () => tpl("t-step1"), null, null);
  }
  function showStep2(instant) {
    step = 1;
    transcript.dataset.awaitSlot = "1";
    runStep(instant, () => tpl("t-step2"), null, () => {
      if (!interacted && !rm.matches) armAutopick();
    });
  }
  function showStep3(instant, full, verb) {
    step = 2;
    delete transcript.dataset.awaitSlot;
    const short = full.split(" · ")[1] ? full.replace(" · ", " ") : full;
    const fills = { short: short, full: full, verb: verb || verbBooked };
    finished = true;
    runStep(instant, () => tpl("t-step3"), fills, null);
  }
  function branchResched() {
    runStep(false, () => tpl("t-resched"), null, null);
    runStep(
      false,
      () => {
        const f = tpl("t-step2");
        f.querySelector(".cl-bubble")?.remove();
        f.querySelector(".cl-toolrow")?.remove();
        f.querySelector('[data-part="2"]')?.remove();
        return f;
      },
      null,
      () => {
        transcript.dataset.resched = "1";
      },
    );
  }
  function branchCancel() {
    runStep(false, () => tpl("t-cancel"), null, null);
  }

  function armAutopick() {
    const dur = Number(segs[1].dataset.dur);
    transcript.classList.add("autopick-armed");
    transcript.style.setProperty("--pick-delay", dur - 1 + "s");
  }

  // ---- player ----
  function paintPlayer() {
    segs.forEach((s, i) => {
      s.classList.toggle(
        "done",
        i < step || (finished && i <= step) || (interacted && i <= step),
      );
      s.setAttribute("aria-selected", String(i === step));
      s.tabIndex = i === step ? 0 : -1;
      // fill = time to READ, so it starts only once the step has settled
      const isRun =
        i === step && !finished && !interacted && !rm.matches && warmedUp && settled();
      if (isRun) {
        if (runSeg !== i) {
          s.classList.remove("run");
          void s.offsetWidth;
          s.classList.add("run");
          runSeg = i;
        }
      } else {
        s.classList.remove("run");
        if (runSeg === i) runSeg = -1;
      }
      s.style.setProperty("--dur", s.dataset.dur + "s");
      if (i > step) s.querySelector(".fill").style.width = "0";
      else s.querySelector(".fill").style.width = "";
    });
    pauseBtn.style.visibility = interacted || finished ? "hidden" : "visible";
  }

  // autoplay is driven by the segment fill animation
  segs.forEach((s, i) => {
    s.querySelector(".fill").addEventListener("animationend", () => {
      if (interacted || i !== step || !settled()) return;
      if (i === 0) {
        flashCta();
        delayed(500, () => showStep2(false));
      } else if (i === 1) {
        showStep3(false, autoSlot, verbBooked);
      } else {
        finished = true;
        paintPlayer();
      }
    });
    s.addEventListener("click", () => {
      takeOver();
      seek(i);
    });
    s.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        segs[(i + 1) % segs.length].focus();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        segs[(i - 1 + segs.length) % segs.length].focus();
      }
    });
  });

  function flashCta() {
    const b = transcript.querySelector('[data-act="book-cta"]');
    if (b) b.classList.add("cta-flash");
  }

  // seek: rebuild the transcript up to checkpoint k, instantly
  function seek(k) {
    clearAppends(); // kills timers, rAF followers and streams
    transcript.textContent = "";
    transcript.classList.remove("autopick-armed");
    delete transcript.dataset.awaitSlot;
    delete transcript.dataset.resched;
    finished = false;
    runSeg = -1;
    showStep1(true);
    if (k >= 1) showStep2(true);
    if (k >= 2) showStep3(true, autoSlot, verbBooked);
    step = k;
    pending = 0;
    paintPlayer();
    scrollDown();
  }

  function takeOver() {
    if (interacted) return;
    interacted = true;
    transcript.classList.remove("autopick-armed");
    paintPlayer();
  }

  // ---- interactivity inside the chat (event delegation) ----
  card.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (!act) return;
    takeOver();
    if (act.dataset.act === "book-cta") {
      if (!transcript.dataset.awaitSlot) showStep2(false);
    }
    if (act.dataset.act === "slot") {
      delete transcript.dataset.awaitSlot;
      act.classList.add("picked");
      const full = act.dataset.full;
      if (transcript.dataset.resched === "1") {
        delete transcript.dataset.resched;
        delayed(350, () => showStep3(false, full, verbMoved));
      } else {
        delayed(350, () => showStep3(false, full, verbBooked));
      }
    }
    if (act.dataset.act === "more") {
      act.parentElement.querySelectorAll("[hidden]").forEach((c) => c.removeAttribute("hidden"));
      act.remove();
    }
    if (act.dataset.act === "resched") branchResched();
    if (act.dataset.act === "cancel") branchCancel();
  });

  // carousel dots follow the scroll position
  card.addEventListener(
    "scroll",
    (e) => {
      const row = e.target.closest?.(".svc-row");
      if (!row) return;
      const idx = Math.round(
        row.scrollLeft / (row.children[0].getBoundingClientRect().width + 8),
      );
      const dots = row.parentElement.querySelectorAll(".dot");
      dots.forEach((d, i) => {
        d.classList.toggle("bg-yes", i === idx);
        d.classList.toggle("cl-dot", i !== idx);
        d.classList.toggle("w-3", i === idx);
        d.classList.toggle("w-1", i !== idx);
      });
    },
    { capture: true, passive: true },
  );

  // composer: honest pointer to the real thing, never a fake AI reply
  composer.addEventListener("click", () => {
    caption.classList.add("pulse");
    setTimeout(() => caption.classList.remove("pulse"), 1200);
  });

  // pause = stop/resume autoplay (any interaction stops it for good)
  function syncPause() {
    const held = userPaused || document.hidden || !inView;
    player.classList.toggle("paused", held);
    card.classList.toggle("paused", held);
    pauseBtn.setAttribute("aria-pressed", String(userPaused));
    pauseBtn.textContent = userPaused ? "▶" : "⏸";
  }
  pauseBtn.addEventListener("click", () => {
    userPaused = !userPaused;
    syncPause();
  });
  document.addEventListener("visibilitychange", syncPause);
  [card, player].forEach((el) => {
    el.addEventListener("pointerenter", () => {
      player.classList.add("paused");
      card.classList.add("paused");
    });
    el.addEventListener("pointerleave", () => syncPause());
  });
  player.addEventListener("focusin", () => {
    player.classList.add("paused");
    card.classList.add("paused");
  });
  player.addEventListener("focusout", () => syncPause());

  const io = new IntersectionObserver(
    (entries) => {
      inView = entries[0].isIntersecting;
      syncPause();
    },
    { threshold: 0.5 },
  );
  io.observe(card);

  // The tap sticker says "this is interactive". Once the visitor has touched
  // anything — a slot, a chapter, the composer, or the keyboard — it has said
  // its piece and gets out of the way, permanently. Capture phase, so it fires
  // even when a handler below stops propagation.
  const shell = card.closest("[data-chat-shell]");
  if (shell) {
    const done = () => shell.setAttribute("data-touched", "1");
    ["pointerdown", "keydown", "focusin"].forEach((ev) =>
      shell.addEventListener(ev, done, { once: true, capture: true, passive: true }),
    );
  }

  // boot: replace the static step 1 with an identical engine-built one, then
  // warm up for 1.5s before autoplay starts counting reading time
  showStep1(true);
  setTimeout(() => {
    warmedUp = true;
    paintPlayer();
    syncPause();
  }, 1500);
  rm.addEventListener("change", paintPlayer);
  paintPlayer();
  syncPause();
}
