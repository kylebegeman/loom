---
name: modernize
description: "Update old work against current product ownership and architecture when asked to modernize or rebase it."
license: MIT
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: tstack
  revision: 1085050f3baed1ac724caa4a8166145fb2ac88af
  adapted-for: loom
---

# Modernize

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Record the actual repository, PR URL, base, head SHA, author, checks and review state. Fetch the base and head, inspect the original intent, and compare base changes since divergence. Check for a replacement in current source and open or merged work.

Choose MODERNIZE, REWORK or CLOSE with concrete evidence before spending effort on a rebase. A clean textual merge does not prove the feature still belongs. Continue an already authorized rework; do not add a new approval gate for routine compatibility fixes. Closure and merging require their own applicable authorization.

Preserve unrelated edits and use the conversation's supported workspace. Honor the chosen branch and model. Rebase or merge according to repository conventions, then compare the series or final diff to confirm behavior and authorship survived. Use an exact observed --force-with-lease only if rebasing this branch is authorized; never overwrite another owner's work. Report disposition, checks and remaining work.
