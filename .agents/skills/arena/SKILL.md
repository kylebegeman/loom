---
name: arena
description: "Compare competing implementations only when the user explicitly requests a bounded arena."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: pstack
  revision: c742dd61706fbacc1b95f1a20b7b988cf096ce6c
  adapted-for: loom
---

# Arena

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Define one measurable goal, common base SHA, allowed scope, verification and selection rule before implementation. Default to two candidates, one round and one synthesis decision. Name exact model settings and a run/spend cap; unavailable models require a user choice, never silent substitution.

Use existing Loom delegates or batches with separate supported workspaces only when parallel work is authorized. Each candidate has independent ownership and returns its branch/head, behavior proof and tradeoffs. No participant dispatches more workers or publishes.

Compare outcomes against the original intent with [blast-radius](../blast-radius/SKILL.md). Re-run decisive evidence, choose one coherent shape and integrate the smallest authorized result. A larger diff is not proof of quality. Report rejected alternatives and gaps, then clean only owned work after safe integration.
