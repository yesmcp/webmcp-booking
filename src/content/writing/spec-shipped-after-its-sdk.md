---
engineeringNote: true
title: "The MCP spec shipped one day after its SDK"
headline: "The MCP spec shipped one day after its SDK, and it still can't speak it"
description: "The 2026-07-28 MCP specification made the protocol stateless and started a twelve-month deprecation clock. The TypeScript SDK was published the day before and still tops out at the November 2025 protocol."
schemaDescription: "The 2026-07-28 MCP specification made the protocol stateless and started a twelve-month deprecation clock. The TypeScript SDK was published the day before and still tops out at the November 2025 protocol."
ogTitle: "The MCP spec shipped one day after its SDK, and it still can't speak it"
ogDescription: "A twelve-month migration clock started on 28 July. The tooling to migrate does not exist yet."
date: "2026-08-10"
dateModified: "2026-08-10"
provenance: "verified against npm and the specification"
ogImage: "/assets/og/spec.png"
lede: "If you run a Model Context Protocol server written in TypeScript, a twelve-month clock started on 28 July 2026. The natural reaction is to plan a migration sprint. Check your tooling first, because as of today the work cannot be done at all."
blurb: "The stateless rewrite landed on 28 July with a twelve-month migration window. The TypeScript SDK that would implement it was published on 27 July, and it tops out at the November 2025 protocol. Nobody is migrating yet. Worth knowing before you plan a sprint."
---

## What the July release changed

The `2026-07-28` specification is not a routine revision. It turns the core protocol inside out, in the words of the release itself:

> MCP is transforming from a bidirectional stateful protocol into a request/response stateless protocol.

In practice: the `initialize` and `initialized` exchange is gone, and so is the `Mcp-Session-Id` header along with the protocol-level session it carried. What used to be negotiated once at connection time now travels in `_meta` on every request. The legacy HTTP+SSE transport is deprecated with a year to move off it, and Dynamic Client Registration gives way to client metadata documents.

For a server author it all comes down to the session. If you kept anything there, a cursor, a cart, a last-read window, a binding to the user, that hiding place is going away. The specification's own advice is to make the state visible instead:

> Servers can mint an explicit handle (a `basket_id`, a `browser_id`) from a tool and have the model pass it back as an ordinary argument on later calls.

## Then we went to migrate, and stopped

Before touching our own production server we did the cheapest possible check: what protocol versions does the installed SDK actually support? The answer is in the package itself.

<div class="evidence">
<p class="eyebrow">Measured 2026-08-10</p>

```console
$ npm view @modelcontextprotocol/sdk dist-tags
{ "latest": "1.30.0" }

# publish time of that version
2026-07-27T17:56:01.640Z

# node_modules/@modelcontextprotocol/sdk/dist/esm/types.js
LATEST_PROTOCOL_VERSION = '2025-11-25'
DEFAULT_NEGOTIATED_PROTOCOL_VERSION = '2025-03-26'
SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25','2025-06-18','2025-03-26',
                               '2024-11-05','2024-10-07']
```

No `2026-*` version appears anywhere in that list. There is no `beta` or `next` dist-tag to opt into. Across 79 published versions the only major branches are 0 and 1.

</div>

Put the two dates next to each other. The specification came out on 28 July. The most recent SDK was published on 27 July, the day before, and has not been touched since. The tool that would implement the new protocol is older than the protocol.

So the honest status is not that we are behind on the migration. It is that the migration has not started anywhere in the TypeScript ecosystem, because it cannot. If a vendor offers to migrate your TypeScript MCP server to the July specification today, ask which SDK version they plan to use.

## What to do with a twelve-month clock and no tooling

Waiting is the correct decision, but idle waiting wastes the runway. Three things are worth doing now, and all of them are cheap:

- **Watch one thing, not a newsletter.** The trigger is a 2.x release or a beta channel appearing on the SDK. That is one command, `npm view @modelcontextprotocol/sdk dist-tags`, run every couple of weeks.
- **Inventory what genuinely depends on the session.** Do it separately for your application logic and for your transport plumbing. The two usually turn out to be very different sizes.
- **Decide the handle design before you need it.** If state has to survive, which identifier does a tool return, and what stops one user's handle from being replayed by another? That question is much easier to answer calmly than mid-migration.

## The part that surprised us

When I ran that inventory on my own production server, half the migration turned out to be done already, by accident. The application state, meaning the practice journal and the last window of source text a user had read, moved off the session and onto the user back in early August, while I was fixing something else entirely. I had found that one host opens a fresh MCP session on nearly every tool call, which made per-session memory unreliable in practice. Around the same time I taught the server to answer any request that arrives without a live session, because otherwise a view's callback would die against a session id the host had cached.

Both changes were bug fixes for host behaviour. Both turn out to be exactly what the stateless specification asks for. What is still tied to sessions on my side is only plumbing: the map from session id to transport instance, plus a binding to the token owner that stops mattering once every request is authorised on its own.

There is a general lesson in that. Hosts are ahead of the specification in the ways they break you. If you have spent your time fixing real host behaviour rather than coding to the document, part of your migration may already be behind you.
