# yesmcp.com — a production booking service with three doors, now including WebMCP

**Live site:** https://yesmcp.com · **WebMCP layer:** [`public/js/webmcp.js`](public/js/webmcp.js)

yesmcp is a real, running business: it builds companies their own MCP connectors so their
customers can book, order and get answers directly inside AI chats. Its own site practices
what it sells — the same production booking service is reachable through **three doors**:

| Door | Who uses it | How |
|---|---|---|
| The web page | A human visitor | https://yesmcp.com/book/ — calendar, form, confirmation email |
| Remote MCP | An assistant in Claude / ChatGPT | `https://mcp.yesmcp.com/mcp` — guest-access MCP server, 10 tools |
| **WebMCP** (this submission) | **An agent browsing the site** | `document.modelContext.registerTool(...)` on every page |

All three doors land on the same backend, the same booking rules, the same rate limits.
Nothing is re-implemented per door: a booking is atomic, the confirmation email is sent
*inside* the transaction (if the send fails, the slot is released — a booking nobody was
told about is not a booking), and the owner gets a Telegram ping.

## What the WebMCP layer registers

Six tools on the home page, four on every other page, in
[`public/js/webmcp.js`](public/js/webmcp.js) (no dependencies, no framework). The entrance
gate and the hero demo exist only on the home page, and a tool that cannot work on a page is
never registered there:

- **`get_services`** — the authored services catalog (same content as the MCP tool; the
  answer carries a degradation flag so an agent never presents a stub as the catalog).
- **`check_availability`** — genuinely bookable 30-minute windows with slot ids; every
  label carries an explicit UTC offset, never a bare wall-clock time.
- **`book_consult`** — prepares a REAL booking, then opens a confirmation card **on the
  page**; the request is submitted only after the human visitor clicks *Confirm*. The card
  shows the server's own label for the slot, not the agent's paraphrase. Decline is a
  first-class answer returned to the agent, not an error.
- **`get_live_status`** — live proof numbers from the production connector (serving-since
  date, tool count, real bookings this month).
- **`answer_entrance_check`** (home page only) — the site asks arriving visitors one question at the door;
  this answers it, so an agent can open the page for its human instead of stalling at a
  dialog it cannot see past. Answering *no* triggers the site's joke and leaves a way back in.
- **`drive_demo`** (home page only) — drives the interactive hero chat demo through the
  same controls a finger taps, so the visitor can *watch* the story an agent is telling.
  Honestly labeled as a scripted demo; the real tools sit right beside it.

## Why this use case fits WebMCP

A services business's site is exactly the page where "human and agent together" stops
being a slogan: the agent does the tedious part (find the catalog, list open windows,
fill the form), the human does the human part (decide, and click Confirm on a card that
commits their calendar and their inbox). Before WebMCP an in-browser agent had to
scrape our DOM and guess; now it gets the same honest API our human page uses — and the
human keeps the final click.

Design rules the implementation holds, in order:

1. **The agent never books on its own.** No confirmation click — no request leaves the page.
2. **Progressive by construction.** No `modelContext` API in the browser — no behavior at
   all. The page works exactly as before; the file only ever adds.
3. **No `innerHTML` anywhere.** Every node is `createElement`-built, so agent-supplied
   input can never be parsed as markup on our page.
4. **Honest degradation.** Empty calendar, stub catalog, server refusal — every answer says
   exactly what happened and what to do next (`taken` → re-check availability; `send_failed`
   → the booking was rolled back and the slot stays open).

## Run it locally

```sh
bun install
bun run dev        # the site, at localhost:4321
bun run build      # production build to dist/
```

The WebMCP tools talk to the production backend at `https://mcp.yesmcp.com`, which
allow-lists the `https://yesmcp.com` origin for browser calls (`/availability`, `/services`,
`/book`, `/status` — public, no auth). On localhost the tools register but the backend
refuses the foreign origin — by design: the booking fence is not ours to loosen from a
fork. The backend service is a separate codebase (TypeScript, SQLite, ~490 automated
tests); its public surface is exactly the four endpoints above plus the MCP server.

## Try it as an agent

- **ChatGPT in-app browser / Chrome with WebMCP enabled:** open https://yesmcp.com and ask
  the agent what tools the page offers, then ask it to check availability and book a slot —
  and watch the page hand you the final click.
- **Any MCP client, no browser:** add `https://mcp.yesmcp.com/mcp` as a remote server —
  the same capability through the second door.

## Repository history

The first commit is the site as it ran before the challenge; everything after it is the
WebMCP extension work (September 2026). The production deploy history lives on
Cloudflare Pages; the connector's public status endpoint has reported since 2026-08-21.

## License

MIT — see [LICENSE](LICENSE).
