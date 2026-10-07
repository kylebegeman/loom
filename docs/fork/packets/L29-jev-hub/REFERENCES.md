# L29 references

> Historical V1 reference. On 2026-09-27 Kyle deferred L29 until V2 ships.
> Reassess released contracts and the Jev client choice before using this design.
> See [PRODUCT.md](./PRODUCT.md#current-decision).

Treat external repositories as references, not code to copy.

## Old Loom

None. Old Loom (`bagelvault/loom` 0.13.10) never used Jev or TypeSafe; L29 came from settling
the packet questions (2026-09-24, see [selections.md](../../selections.md), "From selection
to packet"). Closest old patterns, for shape only:

- The snippets library's server-side store with revisions and the `.loom-snippet.md` export
  (L01 REFERENCES.md) informed templates as named server rows with a JSON export.

## Upstream T3 Code

- Secrets: `apps/server/src/auth/ServerSecretStore.ts:138-150` (`get`, `set`, `remove`),
  `:159-221` (directory `0700`, files `0600`, atomic rename); `secretsDir` in
  `apps/server/src/config.ts:145`. Upstream's pattern for keeping a secret out of settings
  and clients: `apps/server/src/serverSettings.ts:135-190` (secret names, redaction for
  clients) and `:782`, `:862-863` (writes). Used through `ext-decide`.
- Scopes: `apps/server/src/auth/RpcAuthorization.ts:27` (`getFullThreadDiff` read), `:51-52`
  (settings read and operate), `:105` (`projectsReadFile` read).
- Thread reads: `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:174`
  (`getProjectShellById`), `:217` (`getThreadShellById`), `:249-273`
  (`getThreadDetailById`, `getThreadDetailSnapshot` with a window);
  `OrchestrationThreadDetailWindow` in `packages/contracts/src/orchestration.ts:973-976`.
- Diffs: `apps/server/src/checkpointing/CheckpointDiffQuery.ts:37-58` (`getTurnDiff`,
  `getFullThreadDiff`); `OrchestrationGetTurnDiffInput` in
  `packages/contracts/src/orchestration.ts:2174-2181`.
- Pending approvals: activities with `kind: "approval.requested"` built in
  `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:435-466` (payload
  `requestId`, `requestKind`, `requestType`, `detail`, `appName`); the projector's pending
  handling in `apps/server/src/orchestration/Layers/ProjectionPipeline.ts:1846,1880`.
- Files: `apps/server/src/workspace/WorkspaceFileSystem.ts:114-120` (`readFile`);
  `ProjectReadFileInput` in `packages/contracts/src/project.ts:199-205` (accepts absolute
  host paths, which the file builder rejects).
- MCP invocation: `apps/server/src/mcp/McpInvocationContext.ts:13-25` (`threadId`,
  `providerInstanceId`), tool pattern in `apps/server/src/mcp/toolkits/device/tools.ts:28-46`
  (non-empty parameters comment at 31-33).
- Composer: `useComposerDraftStore` `getComposerDraft` and `setPrompt`
  (`apps/web/src/composerDraftStore.ts:491,571`), used the same way in
  `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx:1071-1094`; composer handle
  `insertTextAtEnd` (`apps/web/src/components/chat/ChatComposer.tsx:1216-1256`) as the
  fallback.
- Thread navigation: `buildThreadRouteParams` (`apps/web/src/threadRoutes.ts:42`), route
  `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`.
- Settings scope for "Jev off for this project": `useSettingsScope`
  (`apps/web/src/components/settings/SettingsScopeContext.tsx:61`), targets from
  `resolveScopedSettingsTargets` (`apps/web/src/components/settings/scopedSettings.ts:84`).
- Background work: `forkParked` (`apps/server/src/serverActivation.ts:11-26`).
- Lists: `@legendapp/list` (already in `apps/web/package.json`).

## External

- TypeSafe documentation, cached 2026-09-24 (<https://docs.typesafe.ai/llms.txt> is the
  index):
  - [API reference](https://docs.typesafe.ai/api): `POST /v1/systemone`, request and
    answer shapes, errors 401, 422, 429, 529 and backoff.
  - [Models](https://docs.typesafe.ai/models): `jev-1.13.0`, aliases `jev-latest` and
    `jev-preview`, $42 per billion ($0.042 per million) input tokens with free output, 1,200
    requests per minute, 64k and 32k token limits, `GET /v1/models`, pinning versioned ids
    once thresholds are tuned.
  - [Confidence](https://docs.typesafe.ai/confidence): confidence derived from the
    probabilities, thresholds that scale with risk; Noul carries none.
  - [State](https://docs.typesafe.ai/concepts/state): objects with named fields; text only.
  - [Primitives](https://docs.typesafe.ai/primitives) and
    [Advanced: structure](https://docs.typesafe.ai/primitives/advanced): Choice, Score and
    Noul; structured instructions with a `question` field and data beside it (the rule
    `applyQuestionOverrides` follows); per-option rubrics.
  - [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13): the nine
    failure modes behind the lint rules, the buckets and the drafting brief.
  - [Agent skill](https://docs.typesafe.ai/agent-skill): installation writes to agent
    configuration, which is why Loom only links it.
  - [Skill suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion): the
    pattern behind the not-selected L21 idea.
- TypeSafe agent skill: <https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md>
  (MIT per L21's answers; linked, never copied or installed by this packet).
- Reliability diagrams (confidence bins against observed accuracy) are the standard way to
  read calibration; the chart follows that form with ten equal bins.

## Jevgrep review, 2026-09-27

Kyle's link redirects to [dzhng/jevgrep](https://github.com/dzhng/jevgrep).
Inspected source: `8e8f2bc15cc773107fe8ac18a06b57e02bf955b9`; CLI package declares 0.3.2.
This was a source/documentation review, not an installation or runtime benchmark.

### What it changes

Jevgrep answers repository-search questions with relevant file locations and source excerpts.
Its CLI and agent skill can be evaluated independently of Loom's orchestration, with no V2
adapter or Loom panel required. This is a candidate for a separate experiment, not selected
work. The published small evaluation reports lower coding-agent spend but reduced solves;
it does not establish that our workflows become faster or better. See the
[project's results and limits](https://github.com/dzhng/jevgrep#what-we-measured).

It does not supply L29's decision log UI, ratings, templates, calibration or feature policy.
It also does not replace L26's deterministic graph and relationship/impact views. Its
probabilistic retrieval may help agents find code while those packets stay deferred.

### SDK lesson for ext-decide

The [evaluator](https://github.com/dzhng/jevgrep/blob/8e8f2bc15cc773107fe8ac18a06b57e02bf955b9/packages/core/src/evaluator.ts)
uses `experimental_evaluate` from `ai` and `createTypeSafeAi` from `@ai-sdk/typesafe-ai`.
Its own wrapper accepts boolean questions and reduces answers to probabilities, so it is
not a drop-in client for Loom's Choice/Score/Noul decision API. Its core package is private.
Borrow the approach; do not import its retrieval engine into Loom merely for transport.

The official [AI SDK adapter](https://github.com/vercel/ai/blob/main/packages/typesafe-ai/README.md)
supports Choice, Score and Boolean (mapped to Noul), preserves distributions, and exposes
TypeSafe confidence separately in provider metadata. Evaluation is experimental. Compare
that adapter and the [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)
with the old direct-HTTP plan when work resumes. Retain Loom's server-owned keys, switches,
redaction, bounded requests, fallbacks and log/tuning policy whichever transport is chosen.
Do not conflate probability with confidence or stack independent retry policies.

### Trial boundaries

The [CLI guide](https://github.com/dzhng/jevgrep/blob/8e8f2bc15cc773107fe8ac18a06b57e02bf955b9/apps/cli/README.md)
describes source content sent to the configured Jev provider, separate saved credentials
and local caching. A standalone trial would not automatically use Loom's planned key store,
redaction rules or decision log. Its skill installer changes agent configuration; no such
changes were made in this review.

Before making it a default, compare representative Loom/TypeScript, Swift and hardware
repository tasks with and without it. Count final task correctness, wall time, coding-agent
cost and Jev cost, not retrieval cost alone. Keep exact symbol/path reads and rg available.
This comparison is recommended future work, not a claim of measured benefit here.
