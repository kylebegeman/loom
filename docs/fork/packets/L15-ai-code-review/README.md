# L15: AI code review

Status: Needs design session. <!-- Not started | Designing | Ready | In progress | Done | Blocked: reason -->

AI review of the agent's changes before Kyle commits or opens a pull request: a reviewer
(another model, or the same one with a review brief) reads the diff, reports severity-ranked
findings with file and line, and each finding can be handed back to the working thread as a
"fix this" request. Old Loom shipped a version of this (Codex native review with a Claude
fallback, parsed finding cards, "Fix this"). Kyle asked for a separate brainstorm before any
design, so this is a **discovery packet**: it records what old Loom did and learned, what
upstream T3 Code offers today, the options, the questions for the session, and a recommended
v1. It does not commit to a design.

**Do not implement from this folder until the design session's outcome is recorded in
[PRODUCT.md](./PRODUCT.md) and the status is changed to "Ready".**

## Scope

- In (for the session to confirm): reviewing uncommitted changes and a branch against its
  base; structured findings (severity, file, line range, title, body, confidence, category)
  stored per review run; a Review panel; "Fix this" hand-back through the composer; review
  lenses (correctness by default, optional simplicity and UI design lenses).
- Out (unless the session pulls them in): automatic reviews after every turn, posting
  findings to GitHub, reviewing someone else's pull request, blocking commits on findings,
  the provider-native review protocols in v1 (see DESIGN-SESSION.md, option A).

## Surfaces

Web and desktop required; mobile optional (not planned). Remote: everything server-side over
the environment's WebSocket. Upstream servers: entry points hidden or disabled with "Needs a
Loom server".

## Extension points used (provisional, for the recommended v1)

[`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (RPC, ForkLayer, persistence, reactor), [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels) (Review panel), [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp)
(the reviewer's `loom_ai_code_review_submit` tool), [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette), [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings). A diff
panel "Review changes" button, if the session keeps it, uses `ext-diff-header`
([EXTENSION-POINTS.md, section 17](../EXTENSION-POINTS.md#17-diff-panel-header-ext-diff-header)), shared with L26.

## Packet seams (provisional)

Recommended v1: none. The optional "Review changes" button uses `ext-diff-header`, not a
packet seam. Option A (native Codex review) would add four to six seams in
provider code. See [SEAMS.md](./SEAMS.md).

## Optional integrations

- L26 code graph present: include the blast-radius summary of the changed files in the
  reviewer's brief.
- L02 thread lineage present: show the reviewer thread as a related thread of the source.

## Size

Recommended v1: medium to large, about 2,500 to 3,500 lines with tests. Depends on the
session.

## Documents

- [DESIGN-SESSION.md](./DESIGN-SESSION.md): options, questions and the recommended v1. Start
  here.
- [PRODUCT.md](./PRODUCT.md): the problem, what is already decided, and where the session's
  outcome will be recorded.
- [TECHNICAL.md](./TECHNICAL.md): research findings (old Loom, upstream, providers, reference
  tools) and a provisional design of the recommended v1.
- [SEAMS.md](./SEAMS.md): upstream touches per option.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md), [TESTING.md](./TESTING.md): provisional, for the
  recommended v1.
- [REFERENCES.md](./REFERENCES.md): old Loom files, upstream files, reference repositories.
