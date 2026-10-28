---
name: blast-radius
description: "Find what a proposed change can break beyond its diff and prove the key safety invariant."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: pstack
  revision: c742dd61706fbacc1b95f1a20b7b988cf096ce6c
  adapted-for: loom
---

# Blast radius

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Read the intent and complete diff. Trace direct callers, wire formats, persisted state, library semantics, flags, failure paths and clients that consume the same contract. Use the pinned dependency's source for uncertain behavior.

Identify the one or two facts the change's safety depends on. For each, distinguish an assertion, a source citation, a reasoned path analysis, an executed test and a real-client reproduction. Run the cheapest decisive real-code check; mark unproven claims honestly.

Report the changed behavior, demonstrated risks, cleared risks and the remaining decisive check. Keep likelihood and impact grounded. A symbol search alone does not clear indirect consumers. Use existing Reviewer/Verifier bots only when delegation is authorized; broad scope is not permission to fan out.
