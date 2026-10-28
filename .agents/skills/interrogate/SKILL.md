---
name: interrogate
description: "Challenge a significant design or change with executable counterexamples within a bounded review."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: pstack
  revision: c742dd61706fbacc1b95f1a20b7b988cf096ce6c
  adapted-for: loom
---

# Interrogate

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

State the intended behavior, exact base/head and scope. Try the failure cases most likely to violate that intent. A substantive finding needs a real-code reproduction, test or prototype, its command/output and the expected behavior. Do not present style preferences or hypothetical future requirements as proven defects.

The default is one focused review. If the user explicitly requested multiple reviewers, discover their exact available models, set at most three reviewers and one round unless a larger bound was authorized, and give each an independent non-overlapping brief. Prefer a fitting saved Reviewer or Verifier bot. Do not silently substitute a model.

Re-run findings before consolidating them, merge shared root causes and report all verified defects plus coverage gaps. A read-only review does not authorize fixes or public comments. Bot runs cannot dispatch bots or threads.
