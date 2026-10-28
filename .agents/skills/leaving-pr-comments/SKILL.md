---
name: leaving-pr-comments
description: "Write an authorized GitHub review reply or PR comment with concise evidence and clear agent attribution."
license: MIT
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: tstack
  revision: 1085050f3baed1ac724caa4a8166145fb2ac88af
  adapted-for: loom
---

# Leaving pr comments

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

This skill does not authorize posting. Use it when the current task authorizes the comment or review response.

Lead with the finding or resolution, cite the relevant behavior and evidence, and distinguish facts from judgment. Use one plain attribution line, such as "GPT-6.1 Sol via Codex, on behalf of Kyle", with only the identity actually exposed by the harness. Follow a repository's stronger attribution rule. Do not invent a model, user's identity or contributor email, and do not add an emoji convention.

Inspect the exact Markdown, quotations and attachments for private data. Submit multiline text through a structured tool argument or --body-file. Verify the returned comment/review URL. Resolve a review thread only after its explanation was posted successfully.
