#!/usr/bin/env python3
"""Ukrainian spelling/grammar gate for the /ua/ pages.

Extracts the visible text from built dist/ua/**/index.html and runs it through
the LanguageTool public API (uk-UA rules are maintained by the brown-uk
community — this is the tool that knows the 2019 orthography, e.g. проєкт).

Usage:  python3 scripts/uk-spellcheck.py            # after `bun run build`
Exit codes: 0 = clean, 1 = findings, 2 = infrastructure error.

Public-API limits (no key): 20 req/min, 20 KB per request — our pages fit.
Brand/technical words the checker must not flag live in IGNORE below.
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

DIST = Path(__file__).resolve().parent.parent / "dist"
PAGES = sorted(DIST.glob("ua/**/index.html")) + [DIST / "ua" / "index.html"]
API = "https://api.languagetool.org/v2/check"

# Latin brand/tech tokens are stripped before checking (they are not Ukrainian),
# so this list only needs CYRILLIC words the dictionary does not know yet, plus
# prescriptive flags we consciously override (e.g. «доставка» — LanguageTool
# suggests «доставлення», but Nova Poshta and the whole market say «доставка»).
IGNORE = {
    "онборджу",       # profession slang the owner uses deliberately
    "онбордимо",      # same slang, company-voice plural (2026-08-24)
    "будь-якому тарифі",  # correct locative; LT misparses across a line break (2026-08-24)
    "лідогенерацію", "лідогенерація", "лідогенерації",
    "логи", "Логи", "лог", "логів", "логуються",
    "демо-репозиторій", "скрол-анімація", "фінгерпринтингу",
    "плейбук", "плейбука", "плейбуки", "рев'юерів", "веб-",
    # «доставка» and its cases: LT prescribes «доставлення/доставляння», the
    # market (Nova Poshta, every shop checkout) says «доставка». Owner's call,
    # extended to the inflected forms for the scenario map (2026-08-25).
    "доставка", "доставки", "доставку", "доставкою",
    # Owner's call over LT's «безплатний» (2026-08-24, reaffirmed 2026-08-26 and
    # extended to the adverb — the site said «безплатно» in five places, which is
    # what left the two forms mixed on one page).
    "безкоштовному", "безкоштовний", "безкоштовна", "безкоштовно", "безкоштовний тариф",
    "безкоштовні", "безкоштовних",  # plural, same owner call (2026-08-27)
    "безкоштовного",  # genitive, same owner call (price FAQ, 2026-08-31)
    "Чт",             # weekday abbreviation on the hero demo's slot chips (2026-08-25)
    "демо-репозиторії", # valid compound plural, LT lacks it (about proof card, 2026-08-25)
}

# Rule IDs that misfire on marketing copy (lowercase mono-style headings etc.)
IGNORE_RULES = {
    "UPPERCASE_SENTENCE_START",  # eyebrow labels are deliberately lowercase
}

# Inline tags become a space («Листи на <a>x</a> пересилаються» stays one
# sentence, nav links don't glue); every other tag is a block boundary.
INLINE = {"a", "strong", "em", "span", "code", "b", "i", "abbr", "time", "small", "sup", "sub"}
# nav/header/footer are page chrome (link labels, no prose) — checking them
# as running text only produces agreement false positives («Як це працює
# Докази Сценарії…»). Their few words are eyeballed at review time instead.
SKIP = {"script", "style", "svg", "noscript", "nav", "header", "footer"}

from html.parser import HTMLParser


class TextExtractor(HTMLParser):
    """Walks the DOM; skips script/style and aria-hidden subtrees (the ticker
    and the chat mock are decorative), emits blocks of visible text."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip_depth = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if self.skip_depth:
            self.skip_depth += 1
            return
        if tag in SKIP or ("aria-hidden", "true") in attrs:
            self.skip_depth = 1
            return
        self.parts.append(" " if tag in INLINE else "\n")

    def handle_endtag(self, tag):
        if self.skip_depth:
            self.skip_depth -= 1
            return
        self.parts.append(" " if tag in INLINE else "\n")

    def handle_data(self, data):
        if not self.skip_depth:
            self.parts.append(data)


def visible_text(html_src: str) -> str:
    p = TextExtractor()
    p.feed(html_src)
    lines = []
    for line in "".join(p.parts).splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        # Drop pure-latin/tech lines (mono strings, URLs, brand marks).
        if not line or not re.search(r"[а-щьюяіїєґА-ЩЬЮЯІЇЄҐ]", line):
            continue
        # Inline-tag spacing artifacts around punctuation.
        line = re.sub(r"\s+([,.;:!?)])", r"\1", line)
        line = re.sub(r"\(\s+", "(", line).strip()
        # Terminate each block so headings/cards don't merge into the next
        # sentence («Чим я корисний MCP-конектори» class of false positives).
        # A trailing comma means a <br>-split heading — leave it unterminated.
        if line and line[-1] not in ".!?:;»…,":
            line += "."
        lines.append(line)
    # Blank line between blocks = a paragraph boundary for LanguageTool, so
    # cross-block rules (comma-before-щоб etc.) cannot fire across cards.
    return "\n\n".join(lines)


def check(text: str):
    data = urllib.parse.urlencode({"language": "uk-UA", "text": text}).encode()
    req = urllib.request.Request(API, data=data)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def main() -> int:
    pages = [p for p in dict.fromkeys(PAGES) if p.exists()]
    if not pages:
        print("no dist/ua pages found — run `bun run build` first", file=sys.stderr)
        return 2
    total = 0
    for page in pages:
        text = visible_text(page.read_text())
        try:
            result = check(text)
        except Exception as e:  # network/API failure must not pass silently
            print(f"API error on {page}: {e}", file=sys.stderr)
            return 2
        findings = []
        for m in result.get("matches", []):
            ctx = m["context"]["text"]
            bad = ctx[m["context"]["offset"]:m["context"]["offset"] + m["context"]["length"]]
            if bad in IGNORE or m["rule"]["id"] in IGNORE_RULES:
                continue
            repl = ", ".join(r["value"] for r in m["replacements"][:3]) or "-"
            findings.append(f"  «{bad}» → {repl}\n    {m['message']}\n    …{ctx}…")
        rel = page.relative_to(DIST)
        if findings:
            total += len(findings)
            print(f"\n{rel}: {len(findings)} finding(s)")
            print("\n".join(findings))
        else:
            print(f"{rel}: clean")
        time.sleep(3)  # stay under the public-API rate limit
    if total:
        print(f"\nTOTAL: {total} finding(s)")
        return 1
    print("\nAll /ua/ pages clean.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
