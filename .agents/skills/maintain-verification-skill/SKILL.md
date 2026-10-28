---
name: maintain-verification-skill
description: "Reconcile an existing verification skill and feature map with source and an integrated real-client pass."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: pstack
  revision: c742dd61706fbacc1b95f1a20b7b988cf096ce6c
  adapted-for: loom
---

# Maintain verification skill

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Locate the project's existing verification skill, read its index and compare each relevant journey with current source, entry points and recent changes. Use one coordinator-owned app instance or the harness's documented isolated sessions. Do source reading serially unless delegation was explicitly requested; children never start their own dev servers.

Reconcile recipes before the integrated live pass. Follow the harness's permission, fixture and process-ownership rules. Health-check after surprising behavior; clean only owned residue and preserve evidence. Check every in-scope journey, or mark its exact unmet prerequisite and attempted route.

Fix verified skill/map drift. A product defect remains a product defect: fix it within existing authorization or track a handoff to its owner, never rewrite the map to claim it works. Do not open a PR or post externally without applicable authorization. Report clean, changed or incomplete, with coverage, corrections and gaps. Do not commit run notes.
