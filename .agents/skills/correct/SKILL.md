---
name: correct
description: "Turn a demonstrated recurring agent mistake into a focused architectural, type, lint or behavior guard."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: pstack
  revision: c742dd61706fbacc1b95f1a20b7b988cf096ce6c
  adapted-for: loom
---

# Correct

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Identify a repeated failure class from concrete corrections, regressions or reviews. Do not mine unrelated private history. Explain the failure and evidence before adding rules.

Prefer eliminating the bad path with a clear owner or API, then representing the invariant in types, then a narrow lint with an actionable error, then a meaningful behavior regression. Use docs only for judgment the code cannot enforce. Prove the guard rejects a real prior failure and accepts the supported path.

Fix within the authorized task. Do not automatically grow AGENTS tables, create tickets, mandate a new approval process or broaden a one-off correction into an unrelated rewrite. Report the enforced invariant and the check that demonstrates it.
