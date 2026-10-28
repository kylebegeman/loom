---
name: why
description: "Explain a design decision or regression using Library decisions, source history and relevant connected evidence."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: pstack
  revision: c742dd61706fbacc1b95f1a20b7b988cf096ce6c
  adapted-for: loom
---

# Why

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Anchor the question to current code, tests and ownership. Trace relevant Git history, reviews and previous behavior. Search Library for the same project/topic and follow source conversation links. Use relevant available connected sources where they can answer the question, without a mandatory broad sweep of unrelated systems.

Separate what the evidence establishes, reasonable inference, competing explanations and gaps. Cite dates and exact sources. Recent code is not automatically evidence of original intent. An unavailable source is a stated limitation, not a reason to invent a fact.

When the question precedes a change, state which constraints to preserve, change or avoid and what risk needs verification. Stay read-only unless implementation is also authorized. Do not automatically delegate, write trackers or post messages.
