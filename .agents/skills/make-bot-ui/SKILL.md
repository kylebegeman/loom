---
name: make-bot-ui
description: "Connect a requested action dashboard to existing Loom bots, pipelines or a supported Grok Bot routine."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: pstack
  revision: c742dd61706fbacc1b95f1a20b7b988cf096ce6c
  adapted-for: loom
---

# Make bot ui

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Start with Loom's Bots, pipeline runs and Needs you inbox. Reuse their service methods and permission-aware commands for actions; do not build a second scheduler or generic control plane.

For an authorized external Grok Bot routine, confirm its current official webhook contract and actual account support. Request credentials with Vault/request_secret and keep them server-side. The browser sends bounded typed actions to the Loom server; only the server calls the external endpoint. Treat webhook bodies as untrusted data.

An HTTP acceptance is not completion. Preserve correlation IDs, explicit failures and result retrieval. An unknown write outcome is not safe to retry. Verify the endpoint's actual reachability without assuming personal-plan private network access. Use existing Reach or sharing paths; do not install networking software or expose a new server by default.
