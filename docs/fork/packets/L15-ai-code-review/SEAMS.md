# L15 seams

**Packet seams: none.** Every upstream touch belongs to a shared extension point. The engine
(reviewer threads plus an MCP submit tool) needs no provider or orchestration seam, which is
why the design session chose it over native Codex review (4 to 6 seams in provider code, see
[DESIGN-SESSION.md, section 3](./DESIGN-SESSION.md#axis-a-the-review-engine)).

## Extension points

Run each existence check; create any missing extension point exactly as specified in
[EXTENSION-POINTS.md](../EXTENSION-POINTS.md), in its own commit, before packet code.

| Extension point                                                                                  | Used for                                                                                                                  |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) with Persistence and Background work | RPC group, `AiCodeReviewService`, migrations, `AiCodeReviewReactor`, `"ai-code-review"` capability.                       |
| [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp)                            | `loom_ai_code_review_submit` and `loom_ai_code_review_start`.                                                             |
| [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels)                                 | Review panel, id `ai-code-review`, launcher letter W.                                                                     |
| [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette)                            | "Review uncommitted changes", "Review branch changes", "Review last turn", "Review a commit", "Open Review panel".        |
| [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings)                                 | "AI code review" section (with its project scope).                                                                        |
| [`ext-diff-header`](../EXTENSION-POINTS.md#17-diff-panel-header-ext-diff-header)                 | "Review changes" button, shared with L26.                                                                                 |
| [`ext-composer`](../EXTENSION-POINTS.md#11-composer-ext-composer)                                | The "Review this turn?" chip as a footer block.                                                                           |
| [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root)                                 | The start dialog host and the keybinding listener.                                                                        |
| [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings)                        | `loom.ai-code-review.start`, unbound by default (no default binding, no `keybindings.json` write).                        |
| `ext-decide` (EXTENSION-POINTS.md, section 18)                                                   | The three decide features: `ai-code-review.reviewer-pick`, `ai-code-review.turn-suggest`, `ai-code-review.finding-merge`. |

`ext-decide` is created exactly as EXTENSION-POINTS.md section 18 specifies when its existence
check fails. L15 uses only `LoomDecide.decide` (`apps/server/src/fork/decide/LoomDecide.ts`),
the registry (`apps/server/src/fork/decide/registry.ts`), `diffExcerpt`
(`apps/server/src/fork/decide/diffExcerpt.ts`) on the server, and `useDecideFeature`
(`apps/web/src/fork/decide/state.ts`) on the web. `decide` applies `redactState` and
`fitBudget` itself; L15 never calls the Jev HTTP API or `JevClient` directly.

## Registrations (fork-owned files, not seams)

| Registry                                                           | Entry                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `packages/contracts/src/fork/index.ts`, `fork/rpc.ts`              | `export * from "./ai-code-review.ts"`, `AiCodeReviewRpcGroup`       |
| `apps/server/src/fork/ForkRuntime.ts`                              | `AiCodeReviewService` layer and the reactor                         |
| `apps/server/src/fork/features.ts`                                 | `"ai-code-review"` in `LOOM_SERVER_FEATURES`                        |
| `apps/server/src/fork/persistence/migrations.ts`                   | `AiCodeReviewMigrations`                                            |
| `apps/server/src/fork/rpc.ts` and its scope table                  | handlers and one scope per tag                                      |
| `apps/server/src/fork/mcp/index.ts`                                | `AiCodeReviewToolkitRegistrationLive`                               |
| `apps/server/src/fork/decide/registry.ts` (`FORK_DECIDE_FEATURES`) | `...aiCodeReviewDecideFeatures` (from `ai-code-review/decide.ts`)   |
| `apps/web/src/fork/panels/registry.ts`                             | `aiCodeReviewPanel`                                                 |
| `apps/web/src/fork/commandPalette/registry.ts`                     | `aiCodeReviewPaletteSource`                                         |
| `apps/web/src/fork/settings/registry.ts`                           | `aiCodeReviewSettings`                                              |
| `apps/web/src/fork/diffHeader/registry.ts`                         | `aiCodeReviewDiffHeaderAction`                                      |
| `apps/web/src/fork/composer/registry.tsx` (`FORK_COMPOSER_BLOCKS`) | `aiCodeReviewSuggestionChip`                                        |
| `apps/web/src/fork/ForkRoot.tsx`                                   | `{ id: "ai-code-review-dialog", Component: StartReviewDialogHost }` |
| `packages/contracts/src/fork/keybindings.ts`                       | `"loom.ai-code-review.start"`                                       |

Optional, only when the other packet is present: L18's `PROFILE_BINDING_SOURCES`
(`apps/web/src/fork/project-profiles/bindingSources.ts`) gains the reviewer binding source;
L02's `fork_thread_lineage_links` receives rows by SQL (no code import). Both are fork-owned
files; neither is an upstream seam.

## Merge check

After implementation:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Conflicts may only be on the marked lines of the extension points above.

## FORK.md rows

None for this packet. Extension points it creates add their own rows to "Extension point
seams" in their own commits.
