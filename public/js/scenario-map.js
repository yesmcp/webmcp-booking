/**
 * Wizard upgrade for /scenario-map/ (and /ua/scenario-map/).
 *
 * The page is complete without this file: every map is already in the HTML as
 * a <details> entry and every business card is an anchor into it. All this
 * script does is assemble the ONE map the visitor asked for out of the markup
 * that is already on the page, so no copy is duplicated in JavaScript and the
 * no-JS and JS readings can never say different things.
 *
 * Enhancement layer on top of that baseline: a completed step collapses into a
 * one-line summary («✓ chosen · change»), the feasibility hints under the
 * systems options only show for the option the visitor actually picked, and
 * the map renders only after BOTH questions are answered — same order as the
 * connector's own intake. With JS off every option and hint stays visible.
 *
 * Vanilla, no framework, served from public/ (the CSP allows script-src 'self'
 * only, and the inline bootstrap hash must not change).
 */

const cards = document.querySelectorAll("[data-vertical]");
const result = document.querySelector("[data-result]");
const slot = document.querySelector("[data-result-slot]");
const browse = document.querySelector("[data-browse]");
const summaryTemplate = document.querySelector("[data-summary-template]");

if (cards.length > 0 && result && slot && browse && summaryTemplate) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SELECTED = ["border-yes", "bg-yes/5"];

  /**
   * The visitor's own answers, kept so that leaving the page does not cost them
   * the map. Without this, following any link out of an assembled map — the
   * vertical page, the connector, an article — and coming back left a
   * half-checked form with no result: the browser restores the radios, but the
   * map is assembled by this script and was gone.
   *
   * sessionStorage, not a cookie and not localStorage: it never leaves the
   * browser, it is scoped to this tab, and it is forgotten when the tab closes.
   * The key is deliberately NOT scoped to the pathname. It used to be, and the
   * effect was that switching language threw the visitor's answers away and
   * restarted the questionnaire (site audit, 2026-08-29). What is stored are
   * language-independent codes (`salon-beauty`, `spreadsheets_calendars`), and
   * `sync-diagnostic.mjs` exits non-zero if the two locale files ever drift
   * apart on those ids, so one key is safe for both.
   */
  const STORE_KEY = "yesmcp:scenario-map";
  /** True while the saved state is being replayed: suppresses the scrolling. */
  let restoring = false;
  const save = () => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ vertical, answers }));
    } catch {
      // Private mode or a full quota: the wizard keeps working, it just forgets.
    }
  };

  /** One entry per question id; the map waits until every entry is non-null. */
  const answers = {};
  /** One replay function per question, filled as the questions are wired up. */
  const restorers = [];
  const questionFieldsets = document.querySelectorAll("[data-question]");
  for (const fieldset of questionFieldsets) answers[fieldset.getAttribute("data-question")] = null;
  let vertical = null;

  const scrollTo = (el) => {
    if (restoring) return;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  };

  /**
   * Collapse a step: hide its body, show a «✓ label · change» row after it.
   * `onChange` re-expands the step; each step keeps at most one summary row.
   */
  const collapse = (body, label, onChange) => {
    const existing = body.parentElement.querySelector("[data-summary-row]");
    if (existing) existing.remove();
    const row = summaryTemplate.content.cloneNode(true).firstElementChild;
    row.setAttribute("data-summary-row", "");
    row.querySelector("[data-summary-label]").textContent = label;
    row.querySelector("[data-summary-change]").addEventListener("click", () => {
      row.remove();
      body.hidden = false;
      onChange();
    });
    body.hidden = true;
    body.after(row);
  };

  // Option hints (feasibility notes, channel notes): hidden until an option
  // is picked, then only the picked one shows (the no-JS page shows them all —
  // nothing is JS-only copy).
  const makeHints = (attr) => {
    const nodes = document.querySelectorAll(`[${attr}]`);
    const show = (key) => {
      for (const node of nodes) node.hidden = node.getAttribute(attr) !== key;
    };
    show(null);
    return show;
  };
  const showHint = makeHints("data-feasibility");
  const showChannelHint = makeHints("data-channel-note");

  /** The feasibility note the visitor's own answer points at, or null. */
  const verdictNode = () => {
    if (!answers.systems) return null;
    const source = document.querySelector(`[data-feasibility="${answers.systems}"]`);
    if (!source) return null;
    const verdict = source.getAttribute("data-verdict");
    const template = document.querySelector(`[data-verdict-template="${verdict}"]`);
    const wrapper = document.createElement("div");
    if (template) wrapper.append(template.content.cloneNode(true));
    const note = document.createElement("p");
    note.className = "mt-3 leading-relaxed text-ink-soft";
    note.textContent = source.textContent;
    wrapper.append(note);
    // The channel note joins the verdict — except under yellow, where "your
    // bookings need a digital home first" would contradict it (the connector's
    // own tool suppresses it the same way).
    if (answers.customer_channel && verdict !== "yellow") {
      const channelSource = document.querySelector(`[data-channel-note="${answers.customer_channel}"]`);
      if (channelSource) {
        const channelNote = document.createElement("p");
        channelNote.className = "mt-3 leading-relaxed text-ink-soft";
        channelNote.textContent = channelSource.textContent;
        wrapper.append(channelNote);
      }
    }
    return wrapper;
  };

  /** `map_<vertical>` + the answer codes the two checked radios carry. */
  const deepLink = (href) => {
    let link = href;
    for (const q of ["systems", "customer_channel"]) {
      const radio = document.querySelector(`input[name="${q}"]:checked`);
      const code = radio && radio.getAttribute("data-code");
      if (code) link += `_${code}`;
    }
    return link;
  };

  const render = () => {
    const source = document.querySelector(`[data-map="${vertical}"] [data-map-body]`);
    if (!source) return;

    const map = source.cloneNode(true);
    map.removeAttribute("data-map-body");
    const holder = map.querySelector("[data-verdict-slot]");
    const verdict = verdictNode();
    if (holder && verdict) holder.replaceWith(verdict);
    else if (holder) holder.remove();
    // The bot CTA carries the answers, so the bot never re-asks them.
    const cta = map.querySelector('a[href*="t.me"]');
    if (cta) cta.setAttribute("href", deepLink(cta.getAttribute("href")));

    slot.replaceChildren(map);
    slot.classList.add("rounded-2xl", "border", "border-ink/10", "bg-white/40", "p-6");
    result.hidden = false;
    // Once a map is assembled the browse list would repeat it verbatim, so it
    // steps aside. Picking another card re-renders the result in place.
    browse.hidden = true;
    scrollTo(result);
  };

  /**
   * The single routing rule: go to the first thing still missing — the
   * business pick, then each unanswered question in page order — and only
   * when nothing is missing, render the map.
   */
  const advance = () => {
    if (!vertical) return;
    for (const fieldset of questionFieldsets) {
      if (!answers[fieldset.getAttribute("data-question")]) {
        scrollTo(fieldset);
        return;
      }
    }
    render();
  };

  const step1Body = document.querySelector("#step-1 [data-step-body]");

  for (const card of cards) {
    card.addEventListener("click", (event) => {
      event.preventDefault();
      vertical = card.getAttribute("data-vertical");
      for (const other of cards) {
        const chosen = other === card;
        other.classList.toggle(SELECTED[0], chosen);
        other.classList.toggle(SELECTED[1], chosen);
        if (chosen) other.setAttribute("aria-current", "true");
        else other.removeAttribute("aria-current");
      }
      if (step1Body) {
        collapse(step1Body, card.textContent.trim(), () => {
          scrollTo(document.getElementById("step-1"));
        });
      }
      save();
      advance();
    });
  }

  for (const fieldset of questionFieldsets) {
    const q = fieldset.getAttribute("data-question");
    const body = fieldset.querySelector("[data-step-body]");
    if (!body) continue;

    const showQuestionHint = (key) => {
      if (q === "systems") showHint(key);
      else if (q === "customer_channel") showChannelHint(key);
    };

    const answered = (radio) => {
      answers[q] = radio.value;
      showQuestionHint(radio.value);
      const label = radio.closest("label");
      const labelText = label ? label.querySelector("span span").textContent.trim() : radio.value;
      collapse(body, labelText, () => {
        showQuestionHint(answers[q]);
        scrollTo(fieldset);
      });
      save();
      advance();
    };

    for (const radio of body.querySelectorAll('input[type="radio"]')) {
      radio.addEventListener("change", () => answered(radio));
    }

    // Re-collapse when the visitor re-opens via «change» and confirms the same
    // option (no change event fires on an already-checked radio).
    body.addEventListener("click", (event) => {
      const label = event.target.closest("label");
      if (!label || body.hidden) return;
      const radio = label.querySelector('input[type="radio"]');
      if (radio && radio.checked && answers[q] === radio.value) answered(radio);
    });

    restorers.push((value) => {
      const radio = body.querySelector(`input[name="${q}"][value="${CSS.escape(value)}"]`);
      if (radio) {
        radio.checked = true;
        answered(radio);
      }
    });
  }

  /**
   * Replay whatever this tab already answered. It drives the SAME paths a
   * visitor's clicks would, so there is no second rendering path to keep in
   * sync — the only difference is that `restoring` mutes the scrolling, so
   * coming back lands where the reader left instead of jerking the page.
   */
  const restore = () => {
    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || "null");
    } catch {
      return;
    }
    if (!saved || !saved.vertical) return;

    restoring = true;
    const card = document.querySelector(`[data-vertical="${CSS.escape(saved.vertical)}"]`);
    if (card) card.click();
    let i = 0;
    for (const fieldset of questionFieldsets) {
      const value = saved.answers && saved.answers[fieldset.getAttribute("data-question")];
      const apply = restorers[i++];
      if (value && apply) apply(value);
    }
    restoring = false;
  };
  restore();
}
