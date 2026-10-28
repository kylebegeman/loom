---
name: create-verification-skill
description: "Create a project verification skill only when the project lacks a useful existing harness."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: pstack
  revision: c742dd61706fbacc1b95f1a20b7b988cf096ce6c
  adapted-for: loom
---

# Create verification skill

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Inspect the project's documented launch commands, real surfaces, isolation, auth, existing automation and evidence paths. Reuse an existing harness before adding one. For Loom, extend test-t3-app/test-t3-mobile and their feature maps instead of generating another driver.

Create a provider-discoverable project skill with exact launch/readiness, doctor, drive, evidence and owned-process cleanup instructions. Cover three to five important journeys in a feature-map index. Each journey names user entry points, preconditions, observable results, reverse states and relevant clients/providers/connection modes. Do not weaken a journey because fixtures lack a prerequisite.

Prove one generated journey end to end with the actual supported harness and existing authorization for browsers/devices. Capture actions and side effects, not just a final screen. Keep evidence outside the worktree and verify it survives cleanup. An unexecuted harness is a draft; name gaps. Use [maintain-verification-skill](../maintain-verification-skill/SKILL.md) for upkeep.
