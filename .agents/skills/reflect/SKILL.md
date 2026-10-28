---
name: reflect
description: "Extract demonstrated reusable lessons from this conversation and improve an owned skill within authorized scope."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: pstack
  revision: c742dd61706fbacc1b95f1a20b7b988cf096ce6c
  adapted-for: loom
---

# Reflect

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Use this conversation and narrowly linked evidence. One-off preferences are not repeated failures. Separate accepted lessons, rejected interpretations and unresolved work with citations to actual moments.

Use [correct](../correct/SKILL.md) when structure would enforce the lesson more reliably than instructions. For a skill correction, name the destination and the behavior it should improve. Never edit plugin caches or automatically grow global instructions.

Apply changes already authorized by the user's request; otherwise present a concrete reviewable change before asking about a wider persistent edit. Validate the skill and exercise a realistic task when its behavior is complex. Do not auto-post backlog tickets, open PRs or launch a review fan-out.
