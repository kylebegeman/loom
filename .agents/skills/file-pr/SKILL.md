---
name: file-pr
description: "File or update a concise pull request when the user explicitly requests a PR."
license: MIT
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: tstack
  revision: 1085050f3baed1ac724caa4a8166145fb2ac88af
  adapted-for: loom
---

# File pr

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Resolve the repository explicitly and check for an existing PR for this branch. Read the complete final diff against its actual base. Preserve contributor authorship and scope.

Run the repository's changed-file checks and relevant behavior proof. Lead the title and description with the concrete problem and resulting behavior; include validation and material limits. End with the verified public model name and harness. Do not guess model identities or add private details.

Create a PR only within the user's requested delivery. Respect an explicit draft preference and the repository's workflow. For multiline CLI bodies, use an exact temporary file and --body-file. Immediately call link_pull_request for every created or updated PR. If asked to monitor, continue with [babysit-pr](../babysit-pr/SKILL.md). Comments use [leaving-pr-comments](../leaving-pr-comments/SKILL.md).
