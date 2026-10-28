---
name: council
description: "Use an explicitly requested bounded council for a disputed consequential decision."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: tstack
  revision: 1085050f3baed1ac724caa4a8166145fb2ac88af
  adapted-for: loom
---

# Council

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

State the decision, evidence, constraints, named decision owner, exact participants and cost/run bound. Default to at most three participants, two rounds and no implementation. Use available saved bot models or explicit model selections; do not silently replace a requested provider/model.

Give each participant the same source-grounded question and ask for a recommendation, assumptions, objections and what evidence would change it. Use Loom's existing delegate/batch services only within explicit delegation authorization. Bot runs cannot create threads or dispatch bots.

Verify material claims, then use the second round only for unresolved concrete objections. Stop at the bound, preserve dissent and distinguish consensus from the decision owner's choice. Council output does not authorize shipping, extra reviews or indefinite rounds. If delegation is unavailable, report that prerequisite and continue independent evidence gathering.
