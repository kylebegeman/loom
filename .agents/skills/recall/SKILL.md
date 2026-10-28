---
name: recall
description: "Reconstruct a named project topic from Library history, decisions and current repository state."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: pstack
  revision: c742dd61706fbacc1b95f1a20b7b988cf096ce6c
  adapted-for: loom
---

# Recall

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Keep this read-only. Use the conversation's Library scope. Resolve an ambiguous project through loom_library_projects and inspect its components before searching. Default an unspecified recent window to seven days and say so; honor an explicit broader window.

Search with loom_library_search, then read only relevant conversations using t3_thread_read, paging as needed. Library history includes offline computers, so retain source dates and computer identity. Never mine provider transcript directories or another project's history by default. A complete supplied handoff can replace history mining.

Verify referenced branches, PR heads and checks against current read-only state. Saved history is evidence of a prior decision, not proof that a job is running now or permission to resume it. Report goal and status, source-linked decisions, active ownership, unresolved questions and the concrete next move. Cite thread links and mark unavailable live checks. Do not create a second memory store.
