---
name: ketchup
description: "Give a read-only catch-up of a project or conversation, including actual decisions waiting on the user."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: pstack
  revision: c742dd61706fbacc1b95f1a20b7b988cf096ce6c
  adapted-for: loom
---

# Ketchup

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Use [recall](../recall/SKILL.md) for cross-conversation context, or the current conversation since the user's named checkpoint. Notifications are not user decisions. Verify the current state of artifacts the brief depends on.

Lead with what changed and whether anything actually needs the user. Give every pending decision enough context to act: affected item, recommendation, evidence, risk and alternatives. Work the agent can finish is remaining work, not a permission request. Include older still-pending decisions without inventing new ones.

Keep ordinary status concise, link existing evidence and distinguish complete, in progress, failed and unverified. No code, jobs, external posts or agent dispatch during catch-up. Do not require visuals where plain prose suffices.
