---
name: how
description: "Explain a named subsystem’s runtime flow, ownership and boundaries from current source."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: pstack
  revision: c742dd61706fbacc1b95f1a20b7b988cf096ce6c
  adapted-for: loom
---

# How

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Bound the question to the named behavior and code. Follow its entry point, domain owner, state, effects, external boundaries and consumers. Read the actual dependency source for uncertain contracts. Use direct exploration for routine questions; do not dispatch workers automatically.

Explain the few concepts needed to understand the runtime, then the sequence and important failure/recovery paths. Cite concrete files and symbols. Distinguish current behavior from intent, hypotheses and unverified runtime claims. Use a small diagram only when it clarifies relationships; avoid a file catalog or line-by-line narration.
