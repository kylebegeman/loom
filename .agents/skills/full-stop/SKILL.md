---
name: full-stop
description: "Use only for an explicit request to invoke the full-stop delivery workflow, leaving the result ready for human merge."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: tstack
  revision: 1085050f3baed1ac724caa4a8166145fb2ac88af
  adapted-for: loom
---

# Full stop

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Ordinary punctuation or "full stop" used as emphasis does not invoke this workflow. An explicit full-stop workflow request means finish and verify the specified task, then leave its committed branch or requested PR ready for the user. Never merge or arrange auto-merge under this mode.

Follow [full-send](../full-send/SKILL.md) for implementation, proof and current-head gates, with its merge step replaced by a handoff. Preserve separate browser/device, deployment and production permissions. Do not create a PR unless requested or clearly included in the authorized delivery.

If an owned PR already has auto-merge/queue enabled, remove that automatic landing within this explicitly requested hold and report it. Do not mutate someone else's merge settings. Before handoff, fetch the base, verify the actual head and gates, unwatch an owned PR, and report ready, waiting on a real approval, or incomplete with exact evidence and remaining work.
