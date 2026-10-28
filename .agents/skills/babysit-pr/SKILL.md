---
name: babysit-pr
description: "Watch an owned pull request and act on new checks or review findings when asked to monitor it."
license: MIT
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: tstack
  revision: 1085050f3baed1ac724caa4a8166145fb2ac88af
  adapted-for: loom
---

# Babysit pr

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Inspect the PR's latest head, required checks, reviews, unresolved findings and base. Use the explicit repository. Verify findings against source and focused evidence before fixing them. Dismiss false positives with a reason when a response is authorized.

Use one Loom watch_pull_request, then end the turn so Loom can wake it. Delegated children never watch; the owning parent does. Do not run a second watcher, pr-wait, polling loop or sleep. A wake reports news, not merge approval. Fetch and reassess a changed base before calling the final head ready.

Keep fixes within the requested intent. Recheck changed behavior, push only within authorization, link the PR immediately after a push, and watch the latest head again when required checks remain. Before a handoff or question call unwatch_pull_request. Merge or close only within the user's authorization and the repository's gates.
