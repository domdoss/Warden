---
name: web-research
description: "Multi-source web research and fact-checking — search strategy, source triangulation, reading past paywalls/JS walls, citation of what was actually read, synthesis into an answer. Use for any 'look into / what's the state of / is it true that / compare' question that needs more than one page."
---

## Search
- `WebSearch` first — 2–3 different phrasings when the first misses. Add the year for time-sensitive topics; add `site:` or `archived` when hunting a specific source.
- Open the top candidates with `WebFetch`. A page that fetches empty or minimal is usually JS-rendered — switch to `browser_navigate` + `browser_snapshot` for that one page instead of skipping the source.

## Triangulate
- Answer from at least TWO independent sources for any factual claim — one source is a lead, two is a claim.
- Prefer primary sources: official docs, the project's own repo/changelog, the paper itself — over articles ABOUT them. For software/library facts (flags, defaults, versions), the repo or docs page outranks a blog or Stack Overflow answer, and both outrank your training memory.
- Check dates on everything: a 2024 page answering a 2026 question is a stale source — find a newer one or say the newest you found.
- Numbers that disagree between sources: report both with their sources, never silently average.

## Fact-check flow
1. Find the CLAIM's original source first (`WebSearch` the exact claim string).
2. Read it (`WebFetch`), quote what it actually says.
3. One confirming and one contradicting search before verdict: `"<claim> true"`, `"<claim> false/debunked/refuted"`.
4. Verdict in one line: CONFIRMED / PARTLY / REFUTED / UNRESOLVED, with the load-bearing source for each.

## Synthesis
- Answer the question that was ASKED in the first sentence, then the evidence, then caveats. Bullet the evidence with a source link per bullet.
- Say what you could NOT find (dead links, paywalled, no 2026 data) — a stated gap is part of the answer.
- Keep the final reply compact — the research trail goes in the message, the conclusion leads it.

## Rules
- Every factual claim in the reply traces to a page you actually fetched this turn.
- Your own prior knowledge is a starting point for search terms, and never the answer itself.
- Deep multi-source dig (10+ pages, comparison tables, long-form) → delegate to a background atlas job with this skill's method in the brief.