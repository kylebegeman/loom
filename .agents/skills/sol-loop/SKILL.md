---
name: sol-loop
description: "Run an explicitly requested bounded Sol review loop with the exact available Sol model."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: tstack
  revision: 1085050f3baed1ac724caa4a8166145fb2ac88af
  adapted-for: loom
---

# Sol loop

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Record the intent, exact base/head, review paths and current check results. Default to three rounds. Extend to five only when the user requested it or a demonstrated auth, data-loss or concurrency defect remains. Later rounds cover changed behavior and open findings. Budget exhaustion is not approval.

Discover exact available models and check saved bots first. Use a Reviewer/Verifier bot only when its pinned model and brief fit the requested Sol review. Otherwise start one delegate_task per new round with role review; never retask a child through t3_thread_send. No fallback model or extra reviewer. A bot run cannot dispatch.

Give the reviewer a self-contained read-only brief, repository/base/head, scope, checks and stable finding IDs. Do not edit reviewed files while it runs. Verify each finding, make the smallest authorized fix, and preserve a concise external ledger of fixed/disputed/declined issues. Re-run affected checks. Stop on approval of the current behavior or only nits; report disputed real findings, model, rounds and actual usage if exposed.
