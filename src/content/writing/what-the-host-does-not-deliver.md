---
engineeringNote: true
title: "What the host doesn't deliver"
headline: "What the host doesn't deliver"
description: "A field guide to the channels between an MCP server and the model: which arrive, which silently don't, and what each costs. Findings from a production connector, each caught by a marker test."
schemaDescription: "A field guide to the channels between an MCP server and the model: which arrive, which silently do not, and what each costs. Four findings, each caught by a marker test."
ogTitle: "What the host doesn't deliver"
ogDescription: "A field on the spec is not a field that arrives. Four findings from a production MCP connector."
date: "2026-08-10"
dateModified: "2026-08-10"
provenance: "observations from Claude on web, mobile and desktop"
ogImage: "/assets/og/channels.png"
lede: "The specification tells you a field exists. It cannot tell you that a particular host puts it in front of the model. Those are two different facts, and only the first one is written down. Everything below is the second kind, learned the expensive way."
blurb: "A field guide to the channels between your server and the model: which ones arrive, which quietly do not, and what each one costs. Four findings, none of them from reading the specification."
---

A caveat before the list. All of this was measured against one vendor's host: Claude, in its web, mobile and desktop forms. I have not tested the others, so I claim nothing about them. That restraint is rather the point of the article.

## 1. The `instructions` field does not arrive

An MCP server can declare `instructions`, and it reads like the natural home for "how this server should be used". I put a unique marker string in it, the sort of token that cannot be guessed, then asked the model whether it could see the string. It could not, in any phrasing of the question.

So any behaviour you put there is decoration. Mine moved to tool descriptions, which do arrive, and for a while into tool results, which turned out to be [a mistake of its own](/writing/tool-results-read-as-injection/).

## 2. A tool's description is unreachable until the tool is loaded

Hosts do not always hand the model every tool at once. Some are deferred and fetched on demand, which means a deferred tool's description cannot tell the model when to use that tool. The model has to be reaching for it already in order to read the instruction.

I learned this from an empty journal. The writing tool carried a clear description saying "call me at the end of every session". The model never called it, so it never read the description telling it to. What fixed it was moving the obligation into the response of a neighbouring tool that *was* loaded. Separately, the first phrase of the description had to be in English, because the host's tool search is queried in English.

## 3. A new session on nearly every call

I built the server assuming a conversation maps to a session. It does not. In production logs, one conversation opens fresh MCP sessions over and over, with a distinct session id for almost every tool call.

<div class="evidence">
<p class="eyebrow">From one 20-minute session, production logs</p>

Twelve tool calls, roughly 52 HTTP requests, and a different session id on each call. Anything stored in a per-session variable is gone by the next call.

</div>

Two things follow. First, keep state per *user* rather than per session. Mine moved to the user early, and that is also what the July 2026 specification now asks of everyone. Second, a view calling back into your server may present a session id that the host has cached and your server retired long ago. Answering that with a 404 breaks the view. What fixed it here was serving any properly authorised request without insisting on a live session.

## 4. The tool list is re-sent before every single call

This one is a cost, not a bug, and it never appears in an estimate unless you look.

<div class="evidence">
<p class="eyebrow">Measured in production</p>

Before each tool call the host re-fetches the tool list: 5698 bytes, every time. Over a twelve-call session that comes to roughly 68 KB of pure repetition, next to the actual work, which here was 0 to 4 ms per call for everything except a corpus search at 470 ms.

</div>

If you are sizing a deployment, protocol overhead dominates the traffic model, not your payloads. Every tool you add gets paid for on every call, by every user, forever. That alone is a good argument for a small, well-chosen tool set, quite apart from anything to do with prompt quality.

## The method: marker tests

All four findings came from the same cheap technique, and that is the transferable part of this article. When you need to know whether a channel reaches the model, put a unique nonsense string into it, something that exists nowhere else, then ask the receiver whether it can see the string. The answer is yes or no, and a plausible-sounding model cannot fake it. Write down what you expect *before* running the test, or any outcome will look like confirmation afterwards.

The discipline behind it is simpler still. A specification, a JSDoc comment, a README, and a model's own recollection are all *hypotheses about behaviour*. They become facts after one decisive test on the real system. That test costs minutes. Finding out from a client costs the engagement.
