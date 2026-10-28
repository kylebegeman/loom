---
name: architect
description: "Design a consequential interface or ownership boundary from real callers before implementing it."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: pstack
  revision: c742dd61706fbacc1b95f1a20b7b988cf096ce6c
  adapted-for: loom
---

# Architect

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Ground the existing runtime with [how](../how/SKILL.md), and use [why](../why/SKILL.md) when changing an established ownership decision. Start with realistic caller usage, the invariant and failure paths, then sketch the smallest types and service boundary that make correct use unsurprising.

For an unsettled consequential choice, compare two structurally different candidates and their tradeoffs. Do not automatically dispatch an arena or select another model. Record the chosen rationale outside the repository unless a durable architectural constraint warrants a normal project document.

Implement the authorized design without inventing an approval gate. Honor an explicit design-only checkpoint. Reconsider the abstraction when repeated implementation friction reveals a wrong owner, unclear lifetime or forced escape hatches; remove the obstructing shape rather than accumulating workarounds. Preserve all requested behavior and surfaces.
