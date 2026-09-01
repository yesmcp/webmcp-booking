// The front-door checkpoint (components/BelieverGate.astro owns the markup).
// Served as a real file from our origin on purpose: the site's CSP allows
// script-src 'self' plus ONE hashed inline bootstrap, and Astro would inline
// a small component script straight into the HTML, where the CSP kills it.
const KEY = "yesmcp-gate";
const gate = document.getElementById("bgate");
const ask = document.getElementById("bgate-ask");
const denied = document.getElementById("bgate-denied");
const deniedTitle = document.getElementById("bgate-denied-title");
const yesBtn = document.getElementById("bgate-yes");
const noBtn = document.getElementById("bgate-no");
const believeBtn = document.getElementById("bgate-believe");
const skipBtn = document.getElementById("bgate-skip");

if (gate && ask && denied && deniedTitle && yesBtn && noBtn && believeBtn && skipBtn) {
  let seen = null;
  try {
    seen = localStorage.getItem(KEY);
  } catch {
    /* private mode: the gate simply shows on every outside arrival */
  }
  // Mid-session internal navigation (logo click from an article) must not
  // meet a checkpoint: only an arrival from outside opens the door quiz.
  let external = true;
  try {
    external = !document.referrer || new URL(document.referrer).origin !== location.origin;
  } catch {
    /* unparseable referrer: treat as external */
  }
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // /?door replays the checkpoint no matter what was remembered: the owner
  // demoes it, a visitor shares it, nobody has to clear their storage.
  const force = new URLSearchParams(location.search).has("door");

  // One-shot state: a fast second tap on the other answer must not start a
  // second scene on top of the first (board finding, 2026-08-31).
  let answered = false;
  let denyTimer = 0;
  let closeTimer = 0;
  const docAc = new AbortController();

  const lock = (on) => {
    const root = document.documentElement;
    if (on) {
      // Compensate the vanishing scrollbar, or the whole page shifts ~15px
      // on desktop and that shift lands in field CLS (pointermove is not an
      // excluding input in the layout-instability spec).
      const gutter = window.innerWidth - root.clientWidth;
      if (gutter > 0) root.style.paddingRight = gutter + "px";
      root.style.overflow = "hidden";
    } else {
      root.style.overflow = "";
      root.style.paddingRight = "";
    }
  };
  const remember = (word) => {
    try {
      localStorage.setItem(KEY, word);
    } catch {
      /* nothing to do: worst case the question returns next visit */
    }
  };
  const close = () => {
    clearTimeout(denyTimer);
    clearTimeout(closeTimer);
    docAc.abort();
    gate.remove();
    lock(false);
  };
  // Jump every animation inside the gate to its end state. getAnimations
  // also returns running CSS transitions (a hovered button snapping is
  // acceptable for a skip); anything unfinishable just keeps running.
  const fastForward = () => {
    gate.getAnimations({ subtree: true }).forEach((a) => {
      try {
        a.finish();
      } catch {
        /* not finishable: leave it running */
      }
    });
  };
  const showDenied = () => {
    if (gate.classList.contains("is-denied")) return;
    gate.classList.add("is-denied");
    // Focus the heading, not the button: a screen reader then announces the
    // joke and the reassurance instead of a bare "Fine, I believe now".
    deniedTitle.focus();
  };

  const enter = () => {
    clearTimeout(denyTimer);
    remember("yes");
    if (reduce) {
      close();
      return;
    }
    if (gate.classList.contains("is-denied")) ask.hidden = true;
    gate.classList.remove("play-deny", "is-denied");
    // The dialog name falls back to the static aria-label ("entrance check")
    // once the panels are gone.
    gate.querySelector("[role='dialog']")?.removeAttribute("aria-labelledby");
    gate.classList.add("play-enter");
    closeTimer = setTimeout(close, 5450);
  };

  const deny = () => {
    remember("no");
    gate.classList.add("play-deny");
    gate
      .querySelector("[role='dialog']")
      ?.setAttribute("aria-labelledby", "bgate-denied-title");
    if (reduce) {
      ask.hidden = true;
      showDenied();
      return;
    }
    denyTimer = setTimeout(showDenied, 4100);
  };

  // a click anywhere mid-animation (or the visible skip button) jumps to the
  // end of the current beat
  const skipScene = () => {
    if (gate.classList.contains("play-enter")) {
      close();
    } else if (gate.classList.contains("play-deny") && !gate.classList.contains("is-denied")) {
      clearTimeout(denyTimer);
      fastForward();
      showDenied();
    }
  };

  const show = () => {
    gate.hidden = false;
    lock(true);
    yesBtn.focus();

    // If anything goes wrong between lock and close, leaving the page must
    // never leave it unscrollable.
    addEventListener("pagehide", () => lock(false), { signal: docAc.signal });

    gate.addEventListener("click", (e) => {
      if (e.target instanceof Element && e.target.closest("button")) return;
      skipScene();
    });
    skipBtn.addEventListener("click", skipScene);

    document.addEventListener(
      "keydown",
      (e) => {
        if (!document.body.contains(gate)) return;
        if (e.key === "Escape") {
          // Escape is a dismissal, not an answer: nothing is remembered,
          // the question may return on the next outside arrival.
          close();
          return;
        }
        if (e.key === "Tab") {
          const focusables = [...gate.querySelectorAll("button, [tabindex='-1']")].filter(
            (el) => el.getClientRects().length > 0 && !el.disabled,
          );
          if (!focusables.length) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (!gate.contains(document.activeElement)) {
            // focus fell to the page behind (a background click): pull it back
            e.preventDefault();
            first.focus();
          } else if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      },
      { signal: docAc.signal },
    );

    yesBtn.addEventListener("click", () => {
      if (answered) return;
      answered = true;
      yesBtn.disabled = noBtn.disabled = true;
      enter();
    });
    noBtn.addEventListener("click", () => {
      if (answered) return;
      answered = true;
      yesBtn.disabled = noBtn.disabled = true;
      deny();
    });
    believeBtn.addEventListener("click", enter, { once: true });
  };

  if (force) {
    show();
  } else if (seen === null && external) {
    // The door opens on the first sign of a REAL person (a pointer moves, a
    // finger touches, a key goes down). A human triggers this within their
    // first instant on the page; a rendering crawler never does, so search
    // engines always see the page itself, not an interstitial.
    // Bounds (board finding): only near the top of the page and only within
    // the first 15 seconds. A visitor already reading section five has
    // earned a pass; interrupting them there is hostile, not funny.
    const ac = new AbortController();
    const arm = () => {
      ac.abort();
      if (window.scrollY > 40) return;
      show();
    };
    for (const ev of ["pointermove", "pointerdown", "touchstart", "keydown"]) {
      addEventListener(ev, arm, { signal: ac.signal, passive: true });
    }
    setTimeout(() => ac.abort(), 15000);
  }
}
