# System prompting principles (de-patching)

How to keep agent prompts from becoming patchwork, per Anthropic context-engineering guidance.

- **Rules → judgement.** Replace a pile of rules with a principle that lets the model decide. A rule plus an `EXCEPT WHEN` clause is a sign the rule is too narrow — fold the exception into one judgement.
- **No rule + EXCEPTION clauses.** If you wrote "always X, except when Y", the rule is wrong. State the judgement once that covers both.
- **Examples → interface design.** Don't bolt on examples to patch failures; design the interface so the right behavior is obvious from the description.
- **Progressive disclosure.** Lead with role + routing; push mechanics (Bash, browser, MCP) into the specialist that owns them.
- **State each instruction once.** Don't repeat the same rule in three sections. Once is enough; duplication drifts into contradiction.
- **Edge cases as `Situation:Action`, not rule piles.** "Fresh play vs change song → EXCLUDE the current video ID" beats a paragraph of exceptions.
- **Prune what the model infers.** If a capable model would already do X, don't instruct it to. Instructions are friction.
- **~1000–2000 words is the standard length.** Longer ≠ better; it dilutes the signal.

Applied 2026-07-30: rewrote the orchestrator prompt (media-playback patchwork → "Match the medium" + "never claim success before the result is in") and the Atlas prompt (verify/don't-verify contradiction resolved, redundant browser sections merged, YouTube shrunk to "activate_skill('youtube')"). Byte/Dexter/Iris/Artemis/Sentry were reviewed and left untouched — already clean.