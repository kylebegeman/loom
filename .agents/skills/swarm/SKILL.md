---
name: swarm
description: "Coordinate explicitly requested parallel coverage with bounded ownership and one consolidated result."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: pstack
  revision: c742dd61706fbacc1b95f1a20b7b988cf096ce6c
  adapted-for: loom
---

# Swarm

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Invocation must include authorization for parallel workers. Define the done predicate, scope, output and selection rule (coverage, first pass or ranked alternatives). Set worker count, round/run limits, exact models and independent writable ownership before dispatch. If missing information materially changes cost or correctness, ask a structured question while doing independent work.

Check loom_bots_list for reusable jobs. Discover available models through orchestrator_capabilities before delegate_task. Use Loom batches or delegates and supported workspace isolation; never make child checkouts in the shell. Preserve exact requested models and report unavailability without substitution. No dispatch from a bot run.

Follow completion notifications and task next instructions; do not poll or duplicate a live worker. Stop extras with task_cancel. Verify returned artifacts and required SHAs/methods. Coverage gaps are not passes. Integrate serially and return one result with verified issues, missing slices and cleanup ownership.
