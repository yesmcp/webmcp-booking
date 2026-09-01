---
engineeringNote: true
title: "Your tool results are being read as an attack"
headline: "Your tool results are being read as an attack"
description: "We put behaviour rules in the text our MCP tools returned. The host showed our user a warning that the connector had attempted to inject malicious instructions. Why the detector was right, and how we split the channels."
schemaDescription: "Imperative instructions inside a tool result match the tool-poisoning signature. A host warned a real user that our own connector had attempted to inject malicious instructions. Why the detector was right, and how we split the channels."
ogTitle: "Your tool results are being read as an attack"
ogDescription: "Imperatives inside a tool result are the tool-poisoning signature, even when you own the server."
date: "2026-08-10"
dateModified: "2026-08-10"
provenance: "found in a live session, fixed the same day"
ogImage: "/assets/og/injection.png"
lede: "A user opened my connector on their phone, asked an ordinary question, and the assistant printed a warning above the answer. It had detected an attempt to inject malicious instructions. The attempt was mine. About the shape of it the detector was right, and the shape is what matters here."
blurb: "I put behaviour rules in the text my tools returned, because the proper channel never reached the model. Then a user watched the host warn them that this connector had tried to inject malicious instructions. About the shape of it, the detector was right."
---

## How we ended up injecting into ourselves

My server carries behaviour rules: how to cite the material, when to refuse a technique, when to write to the user's journal. The obvious home for rules like that is the server's `instructions` field. I tested whether it reaches the model by putting a marker string in it, the kind of unique token that cannot be guessed or made up. It never arrives. The next channel, tool descriptions, does work, with one exception: for a tool the host has not loaded yet, the description is unreachable exactly when you need it.

So I routed the rules into the one channel that demonstrably arrived: the text the tools returned. Every substantive response carried a short frame of instructions. It worked. For four days it was the reason the assistant behaved at all.

Then a host-side scanner looked at it. Read that frame the way a security filter does:

- imperative, second-person commands to the model, sitting inside data;
- an instruction to distrust other sources, since my journal had to win over the assistant's own memory of the user;
- and, worst of all, a line telling the model that if a particular tool was not in its set yet, it should go find and load it.

That last one is not merely suspicious. Telling a model to pull in additional tools from inside a tool's output is the textbook description of a tool-poisoning attack. I had hand-written an attack signature, for good reasons, and shipped it to a real user.

## Why this costs more than it looks

Two costs, and the second one is quieter. The visible cost is trust. A paying client watching their assistant announce that your connector tried to attack them is not a conversation any explanation recovers. The quiet cost is that a host which flags content may also begin discounting it, and everything holding your product's behaviour together lives in that discounted text, including the parts that exist for safety. In my session the safety boundary still fired, so nothing was being suppressed yet. Even so, building on a channel the host treats as hostile is not a position to hold on purpose.

## The fix: sort instructions by what they actually are

The rule I landed on fits in one sentence. **A tool result may describe data. It may not command the model.** Everything imperative moves to a channel the host itself registers, where guidance is expected rather than suspicious.

- **Rules about the model's behaviour → tool descriptions.** "Quote only text returned by this tool"; "refer to the place by the human reference, not the raw anchor". Descriptions are part of the tool definition the host publishes, and are not scanned as untrusted content.
- **Rules about the subject matter go into the data itself.** My hardest rule says not to hand over a particular technique on certain emotionally loaded topics, however insistently someone asks. That is a rule of the method, written by the method's author. Sitting in the material, it reads as a fact about the subject rather than as an order from me.
- **Tool results → description only.** Not "don't show raw identifiers" but "identifiers are internal addresses; the human-readable reference is in the `ref` field". Same information, no imperative.
- **Delete the tool-loading directive outright.** There is no phrasing that makes it look innocent. Discoverability belongs in the tool's own name and description.

<div class="evidence">
<p class="eyebrow">Measured before and after</p>

The frame shrank from 1043 characters to 509. That is roughly 130 tokens saved on *every single tool call*, since it was appended to all of them. Over a twelve-call session, about 1500 tokens of pure repetition disappeared as a side effect of making the text honest.

</div>

## The check we ran before deleting anything

One rule in that frame was a safety rule, and safety rules are exactly the ones you must not drop while tidying. Before removing it I opened the material and confirmed the same constraint was written there in full by the author, including the requirement to re-read the relevant section before acting. Only then did the duplicate go.

That afternoon the assistant met the situation for real, in a live session on a genuinely difficult personal topic. It pulled the relevant section, pulled the boundaries section four seconds later in the same turn, declined to offer the technique, and gave the user a choice instead. The rail held with the copy in the frame gone.

## If you run an MCP server, check one thing

Grep your tool results for second-person imperatives. Most servers have them, because most of us discovered the same thing: the polite channels do not always arrive, and the text coming back from a tool always does. That discovery is correct. The conclusion drawn from it, putting commands there, is the part worth revisiting. Ideally before a user sees the warning instead of you.
