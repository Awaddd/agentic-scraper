# ADR-0004: Snapshot compression to control token growth

**Status:** Accepted

## Context

Each agent step sends the full message history to the LLM, including the accessibility tree snapshot of the page at each prior step. Snapshots are large (~30–80k tokens each). Without compression, a 7-step job consumed ~682k tokens.

Two approaches were tested:

| Approach | Steps | Tokens | Outcome |
|---|---|---|---|
| Full history (no compression) | 7 | 682k | Works, expensive |
| Trimmed history (system + current snapshot only) | 12 | 291k | Infinite scroll loop — model couldn't see it had already scrolled |
| **Compressed history (keep actions, drop old snapshots)** | 7 | 306k | Works, ~55% token reduction |

**Trimmed history failed** because removing the assistant's prior action messages meant the model had no memory of what it had already done — it kept scrolling indefinitely.

## Decision

At step N, replace the snapshot content of step N-1's user message with the one-liner `"[step N-1 snapshot — compressed]"`. The assistant's action messages (what the model chose to do) are preserved in full. The model retains its action history but doesn't re-read old page content.

## Consequences

- Token cost scales roughly linearly with steps rather than quadratically.
- The model can always see: the full current snapshot, its own prior actions, and a stub indicating prior pages existed.
- Old page content is unrecoverable once compressed — this is intentional; the agent shouldn't need to re-read a page it already acted on.
- For jobs where the model needs to revisit a page (e.g. back-navigation), this is acceptable — the current snapshot always reflects the current page state.
