---
name: show-me-your-work
description: "Maintain a concise evidence trail for long-running work outside the repository."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: pstack
  revision: c742dd61706fbacc1b95f1a20b7b988cf096ce6c
  adapted-for: loom
---

# Show me your work

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Use existing thread evidence and the project's handoff mechanism first. For a long task, keep a single external checkpoint with intent, ownership, current branch/head, changed files, verified decisions, exact check results, active processes and next steps.

Record consequential choices, pivots, blockers and phase results, not every command. Evidence pointers must exist and support the claim. Correct earlier mistakes explicitly instead of rewriting history to hide them. Keep credentials and production data out.

Before handoff, reconcile claims against actual commits, artifacts and tool outcomes. Preserve incomplete checks and cleanup ownership. Do not commit a parallel decision ledger or dispatch another model merely to audit the trail.
