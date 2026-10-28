---
name: loom-workflows
description: Choose a curated Loom maintenance, verification, recall or explicitly requested delivery workflow.
license: MIT
---

# Loom workflows

Read [the runtime contract](references/runtime.md). Choose the smallest skill that
matches the actual request; this index does not grant extra actions or delegation.

- Verification and regressions: blast-radius, benchmark-checklist, correct,
  create-verification-skill and maintain-verification-skill. Loom uses test-t3-app
  and test-t3-mobile with their existing Browser and Device drivers.
- Context and design: recall, ketchup, how, why, architect and reflect.
- Delivery and continuity: modernize, takeover, file-pr, babysit-pr and
  leaving-pr-comments. full-send and full-stop require explicit workflow invocation.
- Bounded specialist work: sol-loop, interrogate, swarm, arena and council.
  Model settings, delegation authorization and limits stay explicit.
- Evidence and actions: show-me-your-work and make-bot-ui use existing thread
  evidence and Loom services.

[Catalog](catalog.json) records pinned sources, compatibility and dependency closure.
[Source dispositions](source-dispositions.json) preserves omitted, deferred and
already-covered decisions. Optional tools are not installed by this index.
