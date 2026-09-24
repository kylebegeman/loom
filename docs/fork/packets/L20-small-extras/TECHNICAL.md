# L20 technical design

Citations are to this fork at upstream v0.0.42 (`a931bd85f3`), rechecked on 2026-09-24 at
`137e432394`.

## Overview

One fork service, `SmallExtrasService`, owns the packet's settings and the server side of
each part. Parts are listed in a constant so clients can tell which ones a server ships:

```
 Loom settings section "small-extras"          Right panel "small-extras:containers"
   |- Worktree branch prefix (A)                 |- list (fork RPC)
   |- No AI identification: private projects (D) |- Follow logs -> upstream terminal.open + terminal.write
   |- CLI tools (C)                              v
   v
 loom.small-extras.* (fork RPC) ---------> SmallExtrasService (ForkLayer)
 palette items (D), ForkRoot toasts (D)       |- settings row, private projects, scan state (fork tables)
                                              |- branch namer (A, D)  <- ProviderCommandReactor seam
                                              |- private thread resolver (D) <- ClaudeAdapter seam
                                              |- turn input contributor (D) -> ext-turn-input, order 5
                                              |- commit check reactor (D) -> thread.activity.append + warnings stream
                                              |- container listing (B)
                                              |- CLI probes and update checks (C)
```

## Shared plumbing

### Contracts (`packages/contracts/src/fork/small-extras.ts`)

```ts
/** Every part this packet can ship. A server lists the ones it implements. */
export const SMALL_EXTRAS_PARTS = [
  "worktree-prefix",
  "private-mode",
  "containers",
  "cli-tools",
] as const;
export type SmallExtrasPart = (typeof SMALL_EXTRAS_PARTS)[number];

export const SMALL_EXTRAS_WS_METHODS = {
  info: "loom.small-extras.info",
  getSettings: "loom.small-extras.getSettings",
  updateSettings: "loom.small-extras.updateSettings",
  listPrivateProjects: "loom.small-extras.listPrivateProjects", // part D
  setPrivateProject: "loom.small-extras.setPrivateProject", // part D
  checkPrivateThread: "loom.small-extras.checkPrivateThread", // part D
  renamePrivateBranch: "loom.small-extras.renamePrivateBranch", // part D
  privateModeWarnings: "loom.small-extras.privateModeWarnings", // part D, subscription
  listContainers: "loom.small-extras.listContainers", // part B
  listCliTools: "loom.small-extras.listCliTools", // part C
} as const;

export const WorktreeBranchPrefix = Schema.String.check(
  Schema.isMaxLength(64),
  // Old Loom's rule: lowercase, no refs/heads/, no "//" or "--", alphanumeric ends.
  Schema.isPattern(/^(?!refs\/heads(?:\/|$))(?!.*\/\/)(?!.*--)[a-z0-9](?:[a-z0-9/_-]*[a-z0-9])?$/),
);

export const DEFAULT_WORKTREE_BRANCH_PREFIX = "loom";

export const SmallExtrasSettings = Schema.Struct({
  /** null = upstream's "t3code". Defaults to "loom". */
  worktreeBranchPrefix: Schema.NullOr(WorktreeBranchPrefix),
  containerRuntime: Schema.Literals(["auto", "docker", "podman"]),
  /** Extra executables for the CLI tools list, probed with --version. */
  extraCliTools: Schema.Array(
    Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._+-]{1,64}$/)),
  ).check(Schema.isMaxLength(30)),
});
export const DEFAULT_SMALL_EXTRAS_SETTINGS: SmallExtrasSettings = {
  worktreeBranchPrefix: DEFAULT_WORKTREE_BRANCH_PREFIX,
  containerRuntime: "auto",
  extraCliTools: [],
};

export const SmallExtrasInfo = Schema.Struct({
  parts: Schema.Array(Schema.Literals(SMALL_EXTRAS_PARTS)),
});

export class SmallExtrasError extends Schema.TaggedError<SmallExtrasError>()("SmallExtrasError", {
  reason: Schema.Literals([
    "invalid",
    "storage",
    "probe-failed",
    "not-found",
    "not-a-repository",
    "not-private",
    "not-temporary",
    "git-failed",
  ]),
  message: Schema.String,
}) {}
```

| Tag                   | Payload                            | Success                          | Scope                   | Part |
| --------------------- | ---------------------------------- | -------------------------------- | ----------------------- | ---- |
| `info`                | `{}`                               | `SmallExtrasInfo`                | `orchestration:read`    | all  |
| `getSettings`         | `{}`                               | `SmallExtrasSettings`            | `orchestration:read`    | all  |
| `updateSettings`      | `SmallExtrasSettings`              | `SmallExtrasSettings`            | `orchestration:operate` | all  |
| `listPrivateProjects` | `{}`                               | `{ projects: PrivateProject[] }` | `orchestration:read`    | D    |
| `setPrivateProject`   | `{ projectId, enabled: boolean }`  | `PrivateProjectState`            | `orchestration:operate` | D    |
| `checkPrivateThread`  | `{ threadId }`                     | `PrivateCheckResult`             | `orchestration:read`    | D    |
| `renamePrivateBranch` | `{ threadId }`                     | `{ branch: string }`             | `orchestration:operate` | D    |
| `privateModeWarnings` | `{}` (subscription)                | stream of `PrivateModeWarning`   | `orchestration:read`    | D    |
| `listContainers`      | `{ projectId: ProjectId \| null }` | `ContainersResult`               | `orchestration:read`    | B    |
| `listCliTools`        | `{ checkUpdates: boolean }`        | `CliToolsResult`                 | `orchestration:read`    | C    |

All unary except `privateModeWarnings`, which is a durable subscription listed in
`ForkSubscriptionRpcTag` (EXTENSION-POINTS.md, section 1). Every `error` is
`Schema.Union([SmallExtrasError, EnvironmentAuthorizationError])`. The first part to ship
creates the file with `info`, `getSettings`, `updateSettings` and its own methods; later
parts add theirs. The server's `info` returns the parts it implements (a constant in the
server package, `IMPLEMENTED_SMALL_EXTRAS_PARTS`). Clients call a part's methods only when
`loomFeatures` includes `small-extras` and `info.parts` includes the part, so a newer Loom
client on an older Loom server never calls a missing method; a part missing from
`info.parts` shows "Needs a newer Loom server" instead (settings block and panel) and its
palette items are hidden.

### Storage

Fork migration set, slug `small-extras`, table `fork_migrations_small_extras`:

```sql
-- 1_Settings
CREATE TABLE IF NOT EXISTS fork_small_extras_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2_PrivateMode (part D)
CREATE TABLE IF NOT EXISTS fork_small_extras_private_projects (
  project_id TEXT PRIMARY KEY,
  enabled_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fork_small_extras_private_scans (
  thread_id TEXT PRIMARY KEY,
  turn_start_head TEXT,        -- HEAD when the current turn started; NULL when unknown
  last_scanned_head TEXT,      -- HEAD after the last completed check
  updated_at TEXT NOT NULL
);
```

Settings decode with `SmallExtrasSettings`; invalid or missing JSON yields the defaults (and
logs a warning), so a fresh environment starts with the `loom` prefix. One row per
environment by construction (each server has its own `state.sqlite`). Migration 2 ships with
part D; the migration set's ids are fixed, so whichever part lands first still creates only
the migrations it needs and later parts append theirs in id order.

A fork reactor (`cleanupReactor.ts`, `Layer.effectDiscard` with `forkParked`,
`apps/server/src/serverActivation.ts:11-26`) deletes `fork_small_extras_private_projects`
rows on `project.deleted` and `fork_small_extras_private_scans` rows on `thread.deleted`
(EXTENSION-POINTS.md, section 12, rule 2).

### Service

`apps/server/src/fork/small-extras/SmallExtras.ts`:

```ts
export class SmallExtrasService extends Context.Service<
  SmallExtrasService,
  {
    readonly info: Effect.Effect<SmallExtrasInfo>;
    readonly getSettings: Effect.Effect<SmallExtrasSettings, SmallExtrasError>;
    readonly updateSettings: (
      next: SmallExtrasSettings,
    ) => Effect.Effect<SmallExtrasSettings, SmallExtrasError>;
    // part D
    readonly listPrivateProjects: Effect.Effect<ReadonlyArray<PrivateProject>, SmallExtrasError>;
    readonly setPrivateProject: (input: {
      projectId: ProjectId;
      enabled: boolean;
    }) => Effect.Effect<PrivateProjectState, SmallExtrasError>;
    readonly checkPrivateThread: (input: {
      threadId: ThreadId;
    }) => Effect.Effect<PrivateCheckResult, SmallExtrasError>;
    readonly renamePrivateBranch: (input: {
      threadId: ThreadId;
    }) => Effect.Effect<{ branch: string }, SmallExtrasError>;
    readonly privateModeWarnings: Stream.Stream<PrivateModeWarning>;
    // parts B and C
    readonly listContainers: (input: {
      projectId: ProjectId | null;
    }) => Effect.Effect<ContainersResult>;
    readonly listCliTools: (input: { checkUpdates: boolean }) => Effect.Effect<CliToolsResult>;
  }
>()("loom/small-extras/SmallExtrasService") {}
```

The layer loads settings and the private project set once at build time into memory
(`Ref`s), registers the branch namer and the private thread resolver (below) and the turn
input contributor, all in the layer's scope. `updateSettings` and `setPrivateProject` write
their rows and update the `Ref`s. Dependencies: `SqlClient`, `VcsProcess`,
`ProjectionSnapshotQuery`, `OrchestrationEngineService`, `GitWorkflowService`,
`VcsStatusBroadcaster`, `ServerConfig`, `FileSystem`, `Path`, and `LoomDecide` from
`ext-decide` (part D, branch type only).

### Web settings section

`apps/web/src/fork/small-extras/settingsSection.tsx`, registered as
`{ id: "small-extras", title: "Small extras", Component }` in `FORK_SETTINGS_SECTIONS`. It
reads the selected settings scope (EXTENSION-POINTS.md, Settings: the page is scope-gated
like General; use the scope context from `apps/web/src/components/settings/useScopedSettings.ts:30`)
to pick the environment, checks `supportsLoomFeature(..., "small-extras")`, loads `info` and
`getSettings`, and renders one block for each settings part, in the order A, D, C; a part
that is not in `info.parts` shows "Needs a newer Loom server" in its block. Rows use
upstream's `SettingsRow` and `DraftInput` (`apps/web/src/components/settings/settingsLayout.tsx:268`;
`DraftInput` as used in `SettingsPanels.tsx:2849-2858`).

## Part A: worktree branch prefix

### How upstream names worktree branches

- `WORKTREE_BRANCH_PREFIX = "t3code"` and the temporary branch pattern
  `^t3code/(<8 hex>|<uuid v4>)$` (`packages/shared/src/git.ts:13-20`);
  `buildTemporaryWorktreeBranchName` (`:95-105`) and `isTemporaryWorktreeBranch` (`:107-109`).
- The client picks the temporary branch when it prepares the worktree: web
  `apps/web/src/components/ChatView.tsx:7935`, mobile
  `apps/mobile/src/state/use-thread-outbox-drain.ts:956`; the server passes it through
  (`apps/server/src/ws.ts:1463`, `newRefName: prepareWorktree.branch`).
- On the first user message, `ProviderCommandReactor` generates a name with text
  generation and renames the branch:
  `maybeGenerateAndRenameWorktreeBranchForFirstTurn`
  (`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:877-936`) returns early
  unless `isTemporaryWorktreeBranch(branch)`, then
  `const targetBranch = buildGeneratedWorktreeBranchName(generated.branch);` (`:914`),
  `gitWorkflow.renameBranch` (`:917`), `thread.meta.update` (`:918-924`) and `vcsStatusBroadcaster.refreshStatus` (`:925`), all inside an
  `Effect.gen` generator, so the seam can `yield*`.
  `buildGeneratedWorktreeBranchName` (`:185-206`) strips a leading `t3code/`, sanitizes and
  returns `t3code/<fragment>`.
- Other code that recognizes temporary branches: `CheckpointReactor.ts:553` (skips branch
  drift for temporary refs) and `GitActionsControl.logic.ts:405-406` (does not regress a
  semantic branch to a temporary one). Both keep working because temporary branches keep
  the `t3code/` form.
- PR checkout branches (`t3code/pr-<n>/...`, `apps/server/src/git/GitManager.ts:277`,
  `apps/server/src/sourceControl/BitbucketApi.ts:525`) keep upstream naming (PRODUCT.md,
  Decisions). No seam there.

### Design: one branch namer for parts A and D

The seam replaces the generated name with the result of a fork function that may run an
Effect (part D needs a project lookup and, optionally, Jev):

```ts
// apps/server/src/fork/small-extras/branchNaming.ts
import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface ForkBranchNamingInput {
  readonly threadId: ThreadId;
  /** Upstream's generated name, always `t3code/<fragment>`. */
  readonly branch: string;
  /** The first user message, as upstream passed it to text generation. */
  readonly messageText: string;
}

type BranchNamer = (input: ForkBranchNamingInput) => Effect.Effect<string>;
let namer: BranchNamer | null = null;

/** Registered by SmallExtrasService for as long as its layer's scope lives. */
export const registerForkBranchNamer = (
  next: BranchNamer,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => void (namer = next)),
    () => Effect.sync(() => void (namer = null)),
  );

const NAMER_TIMEOUT = "5 seconds";

/**
 * Called from ProviderCommandReactor (fork: small-extras). Never fails: with no namer
 * registered, on error or on timeout it returns upstream's name unchanged.
 */
export const forkWorktreeBranchName = (input: ForkBranchNamingInput): Effect.Effect<string> =>
  namer === null
    ? Effect.succeed(input.branch)
    : namer(input).pipe(
        Effect.timeoutOption(NAMER_TIMEOUT),
        Effect.map((name) => (name._tag === "Some" ? name.value : input.branch)),
        Effect.catchCause(() => Effect.succeed(input.branch)),
      );
```

The registration pattern is the one `ext-turn-input` uses for its module-level map
(EXTENSION-POINTS.md, section 16): `sendTurn`-style upstream code gains no service
requirement, and upstream's reactor tests, which build no `ForkLayer`, see the unchanged
name. If an Effect name differs in the installed version (`timeoutOption`, `catchCause`,
`acquireRelease`), use the equivalent.

The service's namer:

```ts
const fragmentOf = (branch: string) =>
  branch.startsWith(`${WORKTREE_BRANCH_PREFIX}/`)
    ? branch.slice(WORKTREE_BRANCH_PREFIX.length + 1)
    : branch;

const nameBranch = (input: ForkBranchNamingInput) =>
  Effect.gen(function* () {
    const fragment = fragmentOf(input.branch);
    const project = yield* projectOfThread(input.threadId); // getThreadShellById, cached
    if (partD && project !== null && (yield* isPrivateProject(project.id))) {
      const type = yield* chooseBranchType({
        fragment,
        messageText: input.messageText,
        project,
        threadId: input.threadId,
      });
      return privateBranchName(type, fragment); // part D, below
    }
    const prefix = partA ? (yield* Ref.get(settingsRef)).worktreeBranchPrefix : null;
    return prefix === null || prefix === WORKTREE_BRANCH_PREFIX
      ? input.branch
      : `${prefix}/${fragment}`;
  });
```

(`partA` and `partD` stand for "this server implements the part"; a server with only part D
returns upstream's name for non-private projects.)

Edge cases:

- If the generated name already exists as a branch, upstream's `renameBranch` handles the
  collision the same way for any prefix (verify in `GitVcsDriverCore.renameBranch`).
- If text generation fails, upstream leaves the temporary `t3code/<hex>` branch; the namer
  is never called. In a private project the commit check reports it (part D).
- A nested prefix (`kyle/agents`) is allowed; the worktree directory name replaces `/` with
  `-` (`apps/server/src/vcs/GitVcsDriverCore.ts:3056-3058`), which is harmless.

## Part D: No AI identification (private projects)

### What changes in a private project

| Where                            | Mechanism                                                                                                                                                                           | Providers                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Branch name after the first turn | Branch namer (above): `<type>/<fragment>`                                                                                                                                           | all (server-side rename) |
| Every user turn                  | `ext-turn-input` contributor `small-extras-private-mode`, order 5, block `<loom_private_mode>`                                                                                      | all                      |
| Claude's own attribution         | `attribution: { commit: "", pr: "", sessionUrl: false }` and `includeCoAuthoredBy: false` merged into the Agent SDK `settings` at session start (packet seam in `ClaudeAdapter.ts`) | Claude                   |
| After every turn                 | Commit check reactor: scan new commits, warn                                                                                                                                        | all                      |

Upstream's own text generation for commit messages, pull request titles and bodies, and
branch names adds no attribution (checked in `TextGenerationPrompts.ts` and `GitManager.ts`
per Kyle's answers), so nothing changes there.

### Private project state

- `fork_small_extras_private_projects` holds one row per private project; presence means
  "on". `setPrivateProject({ enabled: false })` deletes the row.
- The service keeps the set in a `Ref<ReadonlySet<ProjectId>>` loaded at layer build, so
  every check below is an in-memory lookup plus a cached thread-to-project lookup
  (`ProjectionSnapshotQuery.getThreadShellById`,
  `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:217`; a thread never
  changes project, so the cache has no expiry, only an LRU bound of 2,000 threads).
- `PrivateProject = { projectId, enabledAt }`,
  `PrivateProjectState = { projectId, enabled: boolean, enabledAt: IsoDateTime | null }`.

### Private thread resolver (for the Claude seam)

```ts
// apps/server/src/fork/small-extras/privateMode/claudeSettings.ts
export const PRIVATE_CLAUDE_SETTINGS = {
  attribution: { commit: "", pr: "", sessionUrl: false },
  includeCoAuthoredBy: false,
} as const;

type PrivateThreadResolver = (threadId: string) => Effect.Effect<boolean>;
let resolver: PrivateThreadResolver | null = null;

export const registerPrivateThreadResolver = (next: PrivateThreadResolver) =>
  Effect.acquireRelease(
    Effect.sync(() => void (resolver = next)),
    () => Effect.sync(() => void (resolver = null)),
  );

/**
 * Spread first into the Claude Agent SDK `settings` object (ClaudeAdapter.ts,
 * fork: small-extras). Never fails. `{}` for non-private threads and when the
 * packet is absent.
 */
export const forkClaudeSessionSettings = (
  threadId: string,
): Effect.Effect<Partial<typeof PRIVATE_CLAUDE_SETTINGS>> =>
  resolver === null
    ? Effect.succeed({})
    : resolver(threadId).pipe(
        Effect.map((isPrivate) => (isPrivate ? PRIVATE_CLAUDE_SETTINGS : {})),
      );
```

The service's resolver never fails: it answers from the in-memory set and the cached thread
lookup, with a 2 second limit. On a lookup error or timeout it **fails closed** when at least
one project is private (returns `true`, hiding attribution in a possibly unrelated Claude
session) and returns `false` when no project is private, so Loom never changes Claude's
behavior for users who never turned the feature on.

Claude Code setting facts, verified 2026-09-24:

- Installed SDK types: `@anthropic-ai/claude-agent-sdk` 0.3.260 (the version `apps/server`
  resolves) defines `Settings.attribution` with `commit` ("Empty string hides
  attribution"), `pr` (same) and `sessionUrl` (omit the Claude-Session trailer and PR link),
  and the deprecated `includeCoAuthoredBy`; the `settings` query option is "equivalent to the
  `--settings` CLI flag", which "has the highest priority among user-controlled settings"
  (`sdk.d.ts`, `Options.settings` and `Settings.attribution`).
- Claude Code documentation (https://code.claude.com/docs/en/settings-reference, sections
  `attribution` and `includeCoAuthoredBy`): "To hide all attribution, set `commit` and `pr`
  to empty strings and `sessionUrl` to `false`"; `includeCoAuthoredBy` is deprecated since
  v2.0.62 and ignored once `attribution.commit` or `.pr` is set. It is kept here only for
  older Claude Code binaries.
- The same page notes that managed settings outrank `--settings`, and that Claude treats
  the user's own CLAUDE.md or memory instructions about attribution as taking precedence
  over these lines. A user-level instruction to add co-author trailers can therefore still
  win; the turn instruction and the commit check cover that case.
- Settings apply when a session starts; a session already running keeps its old value until
  it restarts (PRODUCT.md, States).

### Turn input contributor

Registered by `SmallExtrasService` with `registerForkTurnInputContributor`
(EXTENSION-POINTS.md, section 16): id `small-extras-private-mode`, order 5, so it comes
before L22's modes (10) and L03's goal (20). It returns the block only for threads whose
project is private, from the same in-memory lookups (no SQL on the hot path after the first
turn of a thread), and `undefined` otherwise. It is sent on every turn, except the two
cases in Known limits (slash commands and messages near the input limit).

```text
<loom_private_mode>
This project does not allow AI identification. In commit messages, pull request titles and
bodies, code comments and authorship, do not mention AI, agents, models or tools, and do not
add Co-Authored-By trailers or "Generated with" lines. Commit as the configured git user.
</loom_private_mode>
```

The text is a constant (`PRIVATE_MODE_INSTRUCTION` in the contracts file, so tests and docs
share it); it contains no user text, so no escaping is needed.

### Branch type

Pure module `apps/server/src/fork/small-extras/privateMode/branchType.ts`:

```ts
export const BRANCH_TYPES = ["feature", "fix", "hotfix", "chore", "docs", "refactor"] as const;
export type BranchType = (typeof BRANCH_TYPES)[number];

/** Checked in this order; the first rule that matches wins. Whole words, case-insensitive. */
const RULES: ReadonlyArray<readonly [BranchType, RegExp]> = [
  ["hotfix", /\b(hotfix|urgent|outage|incident|prod(uction)? (bug|issue|down))\b/i],
  [
    "fix",
    /\b(fix(es|ed|ing)?|bug|bugs|broken|crash(es|ing)?|error|errors|regression|fail(s|ing|ure)?)\b/i,
  ],
  ["docs", /\b(docs?|documentation|readme|changelog|comments?)\b/i],
  ["refactor", /\b(refactor(s|ing)?|restructure|reorganize|clean ?up|simplify|rename)\b/i],
  [
    "chore",
    /\b(chore|deps|dependenc(y|ies)|bump|upgrade|ci|lint|format(ting)?|config(uration)?|build)\b/i,
  ],
];

/** Rules run on the generated fragment first (dashes read as spaces), then on the message. */
export function branchTypeFromKeywords(fragment: string, messageText: string): BranchType {
  for (const text of [fragment.replace(/[-_/]+/g, " "), messageText.slice(0, 2_000)]) {
    for (const [type, rule] of RULES) if (rule.test(text)) return type;
  }
  return "feature";
}

/** `fix-login-redirect` + fix -> `fix/login-redirect`; never an empty name. */
export function privateBranchName(type: BranchType, fragment: string): string {
  const withoutLeadingType = fragment.replace(
    /^(feature|feat|fix|hotfix|chore|docs?|refactor)[-/]+(?=.)/,
    "",
  );
  return `${type}/${withoutLeadingType || fragment || "update"}`;
}
```

The fragment is upstream's already-sanitized output (`[a-z0-9/_-]`, at most 64 characters),
so the result is a valid branch name. A fragment that itself contains an agent name (the
user asked for "add claude adapter") is kept: it describes the product, not the author.

### Branch type with Jev (optional, `ext-decide`)

`chooseBranchType` asks Jev only when the project is private **and** `ext-decide` returns an
answer; every other outcome uses `branchTypeFromKeywords`.

- Feature registration (`apps/server/src/fork/small-extras/decide.ts`), in the
  `ext-decide` feature registry (EXTENSION-POINTS.md, section 18):

  ```ts
  export const BRANCH_TYPE_FEATURE: DecideFeature = {
    id: "small-extras.branch-type",
    packet: "L20",
    label: "Branch type in private projects",
    description:
      "Picks feature, fix, hotfix, chore, docs or refactor for a new worktree branch in a project with No AI identification; without Jev, keyword rules pick it (default feature).",
    defaultMode: "manual",
    defaultThreshold: 0.6,
    agentTool: false,
  };
  ```

  `DecideFeature` comes from `apps/server/src/fork/decide/registry.ts`, and the file's export
  is appended to `FORK_DECIDE_FEATURES` there. `manual` means Jev is asked automatically
  (origin `"auto"`) whenever it is allowed for the project. No MCP tool reaches the feature,
  so `agentTool: false` limits its modes to off and manual.

- Call, inside the namer (never on the turn's critical path; the rename runs after text
  generation):

  ```ts
  const result =
    yield *
    decide.decide(
      BRANCH_TYPE_FEATURE.id,
      {
        // decide() runs redactState and fitBudget itself; only cap the message here.
        state: {
          branch_name: fragment.replace(/[-_/]+/g, " "),
          first_message: messageText.slice(0, 3_000),
        },
        questions: {
          branch_type: {
            type: "choice",
            instructions:
              "Which kind of change does `first_message` ask for? `branch_name` is a short summary of the same request.",
            criteria: {
              feature: "Adds new behavior or a new capability.",
              fix: "Corrects a defect in existing behavior.",
              hotfix:
                "Corrects an urgent defect in software that is already released or in production.",
              chore:
                "Maintenance with no behavior change: dependencies, build, CI, tooling or configuration.",
              docs: "Changes only documentation or code comments.",
              refactor: "Restructures existing code without changing its behavior.",
            },
          },
        },
      },
      { origin: "auto", threadId, projectId },
    );
  ```

  `answered` with a `choice` in `BRANCH_TYPES` uses it; `fallback` (any reason: `disabled`,
  `no-key`, `project-off`, `timeout`, `error`, `low-confidence`) uses the keyword rules. The
  threshold is applied by `decide()` itself, so the namer passes none and never re-checks
  confidence. The
  Jev client's own 1 second timeout applies, well inside the namer's 5 seconds. Criteria are
  written literally and contain no negations or counting, per the jev-1.13 guidance
  (https://docs.typesafe.ai/model-jaggedness/jev-1.13).

- **Jev off by default for private projects.** When both parts exist, turning a project
  private sets `ext-decide`'s per-project override to "Jev off" if the project has no
  explicit Jev choice yet, and the service does the same at startup for every private
  project (idempotent). A user who then turns Jev on for that project keeps that choice;
  turning private mode off leaves the Jev choice as it is. It uses `LoomDecide`'s
  `getProjectOverride` (null means no explicit choice) and `setProjectOverride(projectId,
"off")` (EXTENSION-POINTS.md section 18).

### Commit check

`apps/server/src/fork/small-extras/privateMode/commitCheck.ts` (a fork reactor,
`Layer.effectDiscard` with `forkParked`) and the pure `aiMarkers.ts`.

**Trigger and range.** It consumes `OrchestrationEngineService.streamDomainEvents`
(`apps/server/src/orchestration/Services/OrchestrationEngine.ts:83`) and handles, for threads
of private projects only:

- `thread.turn-start-requested` (`packages/contracts/src/orchestration.ts:1813`): record
  `turn_start_head = git rev-parse HEAD` in the thread's checkout (worktree path, else the
  project's workspace root).
- `thread.turn-diff-completed` (`:1874`, carries `checkpointTurnCount`): run the check with
  the range `turn_start_head..HEAD`; when `turn_start_head` is unknown (server restarted
  mid-turn) use `last_scanned_head..HEAD`, and when that is unknown too, `HEAD --not
--remotes` (commits not on any remote). Cap 200 commits. Then store
  `last_scanned_head = HEAD` and clear `turn_start_head`.

A thread whose checkout has no branch (`git symbolic-ref --quiet --short HEAD` prints nothing:
a detached HEAD) is skipped at both events: no log, no warning.

Events are handled one at a time per thread; checks for different threads run with
concurrency 2. A missed event (server down) only skips one check; the palette check covers
it. Recording HEAD races the agent only if the agent commits within milliseconds of the turn
starting; the fallback ranges still catch those commits on the next check.

**Git commands** (through `VcsProcess.run`, `timeoutMs: 10_000`, `maxOutputBytes: 2 MiB`,
never with a shell):

- `git rev-parse HEAD`, `git symbolic-ref --quiet --short HEAD` (branch; detached: none, and
  the thread is skipped).
- `git log --max-count=200 --format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x1e <range>`.
- For flagged commits: `git branch --remotes --contains <oldest flagged>` (non-empty means
  pushed).

**Markers** (`aiMarkers.ts`, pure, one exported constant list so tests and the fix command
use the same patterns):

| Finding             | Rule                                                                                                                                       | Fix            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| `co-author-trailer` | A line `Co-authored-by: <value>` (case-insensitive) whose value names a known agent or has an AI vendor address                            | automatic      |
| `generated-with`    | A line containing "Generated with" or "Generated by" (case-insensitive) that names a known agent or says "AI"                              | automatic      |
| `ai-author`         | Author name or email names a known agent or has an AI vendor address                                                                       | automatic      |
| `ai-committer`      | Same for the committer                                                                                                                     | automatic      |
| `agent-name`        | Subject or body (outside the lines above) contains a known agent name as a whole word, case-sensitive, or "AI-generated"/"generated by AI" | reword by hand |

- Known agents: Claude, Claude Code, Codex, ChatGPT, OpenAI, Anthropic, Copilot, Cursor
  Agent, Gemini, Grok, OpenCode, Antigravity, Devin, Aider, Windsurf, Cline. Plain "Cursor"
  and "agent" are not markers (too common in normal text).
- AI vendor addresses: any address at `anthropic.com`, `openai.com`, `x.ai`, `cursor.com`,
  `cursor.sh`, and GitHub's Copilot bot (`...+Copilot@users.noreply.github.com`). Codex's
  built-in trailer is `Co-authored-by: Codex <noreply@openai.com>` (string found in the
  codex-cli 0.156.1 binary) and Claude's is a `noreply@anthropic.com` address; both match.
- The list is data in one file; adding a name is a one-line change with a test.

**Fix command** (`buildFixCommand(findings, { cwd, oldestSha, isRoot, hasAiAuthor })`, pure):

```sh
git -C '<cwd>' rebase --rebase-merges --exec 'git log -1 --format=%B | grep -v -i -E "<pattern>" | git commit --amend --no-verify --quiet<reset> -F -' <oldest>^
```

- `<pattern>` removes exactly the trailer and "Generated with" lines matched above (the same
  constants, rendered as one ERE with only characters that need no shell quoting inside
  double quotes).
- `<reset>` is ` --reset-author` only when an author was flagged; it resets the rewritten
  commits' author to the configured git user.
- `<oldest>^` becomes `--root` when the oldest flagged commit has no parent.
- `<cwd>` is single-quoted with `'` escaped as `'\''`.
- When only `agent-name` findings exist, the "reword" command is
  `git -C '<cwd>' rebase -i <oldest>^` with the list of commits to reword.
- When the commits are already on a remote, the warning adds the "Already pushed" line from
  PRODUCT.md, Copy. Loom never runs any of these commands.

**Temporary branch.** When `checkpointTurnCount >= 2` and the thread's branch still matches
`isTemporaryWorktreeBranch`, the check sets `temporaryBranch: true` and `renameCommand`. The
first turn is skipped because upstream's rename can finish after a short first turn.
`renamePrivateBranch` fixes it with exactly upstream's steps
(`ProviderCommandReactor.ts:914-925`). The name does not call text generation again (it
already failed for this thread): the thread's first message
(`ProjectionSnapshotQuery.getTurnStartMessage`, `:235`), or the thread title when that is
missing, goes through `generatedWorktreeBranchName` in `branchNaming.ts`, a fork copy of
upstream's module-private sanitizer `buildGeneratedWorktreeBranchName`
(`ProviderCommandReactor.ts:185-206`) that returns `t3code/<fragment>`, and that name goes
through `forkWorktreeBranchName` like upstream's. Then
`GitWorkflowService.renameBranch({ cwd, oldBranch, newBranch })`
(`apps/server/src/git/GitWorkflowService.ts:108`), `thread.meta.update` with the new branch,
and `VcsStatusBroadcaster.refreshStatus(cwd)`. It refuses (`not-temporary`) when the branch
is no longer temporary and (`not-private`) outside private projects. The copyable
alternative is `git -C '<cwd>' branch -m '<old>' '<new>'`.

**Warning** (contracts):

```ts
export const PrivateModeFinding = Schema.Struct({
  sha: Schema.String, // 12 characters
  subject: Schema.String, // clamped to 120 characters
  kinds: Schema.Array(
    Schema.Literals([
      "co-author-trailer",
      "generated-with",
      "ai-author",
      "ai-committer",
      "agent-name",
    ]),
  ),
  detail: Schema.String, // the matched line or field, clamped to 120 characters
});
export const PrivateModeWarning = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  cwd: Schema.String,
  branch: Schema.String, // threads with no branch are skipped
  temporaryBranch: Schema.Boolean,
  findings: Schema.Array(PrivateModeFinding),
  pushed: Schema.Boolean,
  fixCommand: Schema.NullOr(Schema.String), // automatic fixes
  rewordCommand: Schema.NullOr(Schema.String), // agent-name findings
  renameCommand: Schema.NullOr(Schema.String), // temporary branch
  createdAt: IsoDateTime,
});
export const PrivateCheckResult = Schema.Struct({
  isPrivate: Schema.Boolean,
  noBranch: Schema.Boolean, // detached HEAD: nothing checked
  warning: Schema.NullOr(PrivateModeWarning),
  checkedCommits: NonNegativeInt,
});
```

**Delivery.** A check that finds anything:

1. Dispatches the existing internal command `thread.activity.append`
   (`packages/contracts/src/orchestration.ts:1492-1498`) with `tone: "error"` (automatic fixes
   or temporary branch) or `"info"` (names only), `kind: "loom.small-extras.private-mode"`,
   the summary from PRODUCT.md, `payload: PrivateModeWarning`, `turnId` of the checked turn,
   and a server command id `server:loom-small-extras-private:<uuid>`. Upstream's work log
   renders unknown kinds as generic rows (`apps/web/src/session-logic.ts:451-515`), so every
   client, including the mobile app and upstream clients, shows it.
2. Publishes the warning on the service's `PubSub`, streamed to subscribed clients by
   `privateModeWarnings` (no replay; the timeline row is the durable record).
3. Does nothing else: no git command that writes is ever run by the check.

The same warning is not repeated for an unchanged HEAD: the check skips when
`HEAD == last_scanned_head`. `checkPrivateThread` runs the same check on demand with the
range `HEAD --not --remotes` plus `last_scanned_head..HEAD`, returns the result to the caller
only (it does not publish on the `privateModeWarnings` stream), and appends no timeline row.
On a thread with no branch it runs no log and returns `noBranch: true`; outside a git
repository it fails with `not-a-repository`. The messages for both are in PRODUCT.md, Copy.

### Web (part D)

- Settings block `PrivateProjectsBlock.tsx`: the environment's projects (from the web
  entity store for that environment) with a switch each, bound to `listPrivateProjects` and
  `setPrivateProject`, the description and limits note from PRODUCT.md. In a project (or
  checkout) settings scope it lists only the scope's project; in the all (or environment)
  scope it lists every project of the environment.
- Palette source `apps/web/src/fork/small-extras/palette.tsx` (`ext-palette`): items only when
  `loomFeatures` has `small-extras`, there is an active thread, and the environment's
  `info.parts` has `private-mode` (read from the cached `info` query; items are hidden until
  it has loaded):
  - `action:loom:small-extras:private-toggle`: title "Turn on No AI identification for this
    project" or "Turn off ..." from the cached `listPrivateProjects` result (both titles are
    in `searchTerms`, so searching either finds it); `run` resolves the active thread's
    project, calls `setPrivateProject` with the flipped value, then shows the toggle toast
    with "Undo".
  - `action:loom:small-extras:private-check`: `run` calls `checkPrivateThread` and shows the
    warning toast, "No AI markers in this thread's new commits.", or the no-branch or
    not-a-repository message (PRODUCT.md, Copy).
- Toast host `PrivateModeWarningToasts.tsx` in `FORK_ROOT_COMPONENTS` (`ext-web-root`):
  subscribes to `privateModeWarnings` for each connected environment whose capabilities
  include `small-extras` and whose `info.parts` include `private-mode`
  (`createEnvironmentRpcSubscriptionAtomFamily`), and renders nothing itself. For each
  warning it calls upstream's `toastManager.add` (`apps/web/src/components/ui/toast.tsx:79`,
  exported at `:806-812`) with `type: "warning"`, `timeout: 0`, the title and description
  from PRODUCT.md, and `data.expandableContent` listing each finding and the full command.
  Actions per case, matching PRODUCT.md, Copy:
  - automatic fix: `actionProps` "Copy fix command" (writes `fixCommand`), and
    `data.secondaryActionProps` "Open thread";
  - names only: `actionProps` "Copy reword command" (writes `rewordCommand`), and
    `data.secondaryActionProps` "Open thread";
  - temporary branch: `actionProps` "Rename branch" (calls `renamePrivateBranch`),
    `data.secondaryActionProps` "Copy command" (writes `renameCommand`), and "Open thread"
    as a third button through `data.additionalActions` (`toast.tsx:50-53`).

  The palette check uses the same toast builder.

- L18 integration: `PrivateModeProfileRow.tsx` (one `SettingsRow` with the switch for one
  project), registered in L18's `PROFILE_SECTION_ROWS` as
  `{ id: "small-extras-private-mode", feature: "small-extras", Component: PrivateModeProfileRow }`
  when L18 is present (whichever packet lands second adds the line).

### Provider decisions (part D)

| Provider           | Instruction                      | Deterministic switch                                                                                              | Commit check |
| ------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------ |
| Claude             | yes                              | `attribution` settings at session start (packet seam)                                                             | yes          |
| Codex              | yes                              | None in the app-server schema (`packages/effect-codex-app-server/src/_generated`, checked 2026-09-24). See below. | yes          |
| Cursor, Grok       | yes                              | None known.                                                                                                       | yes          |
| OpenCode           | yes                              | None known.                                                                                                       | yes          |
| Antigravity        | yes                              | None known.                                                                                                       | yes          |
| Fork drivers (L17) | yes (they go through `sendTurn`) | None.                                                                                                             | yes          |

Codex facts (2026-09-24): the app-server's generated schema has no attribution option. The
installed codex-cli 0.156.1 binary contains a `<git_attribution>` developer-instruction block
("When you write or edit a git commit message, ensure the message ends with this trailer
exactly once") with the trailer `Co-authored-by: Codex <noreply@openai.com>`, gated by a
`commit_attribution_enabled` value whose source and default are **unverified** (it appears
next to account token data, so it may be an account or workspace setting); `codex features
list` shows the old `codex_git_commit` flag as removed. The official configuration reference
(https://developers.openai.com/codex/config-reference, fetched 2026-09-24) documents no
attribution key. Because a developer instruction outranks text in the user message, the
commit check is the backstop for Codex. IMPLEMENTATION.md has the verification step; if Codex
adds its trailer in practice, a Codex-side switch is a follow-up (PRODUCT.md, Out of scope).

### Known limits

- Temporary `t3code/<hex>` branches exist locally until the first-turn rename; Loom never
  pushes them. Checkpoint refs (`refs/t3/checkpoints`, `apps/server/src/checkpointing/Utils.ts:4`)
  and upstream's `refs/t3code/pre-refresh` (`GitVcsDriverCore.ts:3243`) are hidden local refs
  that a normal `git push` does not send.
- The worktree folder name under `~/.t3/worktrees/<repo>/` derives from the branch name
  (`GitVcsDriverCore.ts:3056-3058`), so the temporary name shows in the local path; it is
  never pushed.
- Code comments and pull request text are covered only by the instruction (and, for Claude,
  its `pr` attribution setting).
- `ext-turn-input` passes messages that start with `/` (slash commands) through unchanged and
  skips a block that would push a message over `PROVIDER_SEND_TURN_MAX_INPUT_CHARS`
  (EXTENSION-POINTS.md, section 16), so those messages go out without the instruction.
- PR checkout branches keep upstream's `t3code/pr-<n>/...` names in private projects too
  (PRODUCT.md, Decisions).

## Part B: containers

### Runtime detection

`containerRuntime: "auto"` tries `docker` then `podman` with `resolveCommandPath`
(`packages/shared/src/shell.ts:619-627`); an explicit choice uses only that one. The server
PATH is already hydrated from the login shell at startup (`apps/server/src/os-jank.ts:20-51`),
so Homebrew, OrbStack and Docker Desktop binaries resolve.

### Listing

| Runtime | Command (through `VcsProcess.run`, `timeoutMs: 10_000`, `maxOutputBytes: 2 MiB`) | Output                   |
| ------- | -------------------------------------------------------------------------------- | ------------------------ |
| Docker  | `docker ps --all --no-trunc --format '{{json .}}'`                               | one JSON object per line |
| Podman  | `podman ps --all --format json`                                                  | one JSON array           |

(Arguments are passed as an argv array, so the `{{json .}}` needs no shell quoting.)

Mapped to:

```ts
export const ContainerEntry = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-f0-9]{12,64}$/)),
  name: Schema.String,
  image: Schema.String,
  state: Schema.Literals([
    "running",
    "paused",
    "restarting",
    "created",
    "exited",
    "dead",
    "removing",
    "unknown",
  ]),
  status: Schema.String, // "Up 3 minutes (healthy)"
  ports: Schema.String,
  composeProject: Schema.NullOr(Schema.String),
  composeService: Schema.NullOr(Schema.String),
  composeWorkingDir: Schema.NullOr(Schema.String),
  matchesProject: Schema.Boolean,
});
export const ContainersResult = Schema.Union([
  Schema.TaggedStruct("Ok", {
    runtime: Schema.Literals(["docker", "podman"]),
    containers: Schema.Array(ContainerEntry),
  }),
  Schema.TaggedStruct("NoRuntime", {}),
  Schema.TaggedStruct("DaemonUnavailable", {
    runtime: Schema.Literals(["docker", "podman"]),
    detail: Schema.String,
  }),
  Schema.TaggedStruct("Failed", {
    runtime: Schema.Literals(["docker", "podman"]),
    detail: Schema.String,
  }),
]);
```

- Docker `Labels` is a comma-separated `k=v` string; Podman `Labels` is an object. Read
  `com.docker.compose.project`, `com.docker.compose.service`,
  `com.docker.compose.project.working_dir` (Podman compose sets the same keys when used
  through `docker-compose`; `podman-compose` sets `io.podman.compose.project`; read both).
- Docker `Names` is a string; Podman `Names` is an array (take the first).
- `matchesProject`: the realpath of `composeWorkingDir` equals the project's
  `workspaceRoot` or one of its threads' worktree paths (from `getShellSnapshot`).
- Daemon down: Docker exits non-zero with "Cannot connect to the Docker daemon" or "Is the
  docker daemon running"; Podman with "Cannot connect to Podman". Map to
  `DaemonUnavailable`, other failures to `Failed` with the first stderr line.
- At most 500 containers returned.

### Follow logs (web only, upstream terminal)

`apps/web/src/fork/small-extras/followContainerLogs.ts`:

```ts
export async function followContainerLogs(input: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  cwd: string; // thread worktree or project root
  runtime: "docker" | "podman";
  container: ContainerEntry;
  openTerminal: AtomCommand<typeof terminalEnvironment.open>;
  writeTerminal: AtomCommand<typeof terminalEnvironment.write>;
}) {
  if (!/^[a-f0-9]{12,64}$/.test(input.container.id)) return;
  const terminalId = `loom-logs-${input.container.id.slice(0, 12)}`;
  const store = useTerminalUiStateStore.getState();
  const alreadyOpen = selectThreadTerminalUiState(
    store.terminalUiStateByThreadKey,
    input.threadRef,
  ).terminalIds.includes(terminalId);
  // Creates the tab if needed, opens the drawer and focuses the tab.
  store.ensureTerminal(input.threadRef, terminalId, { open: true, active: true });
  if (alreadyOpen) return; // the logs are already streaming in that tab
  const opened = await input.openTerminal({
    environmentId: input.environmentId,
    input: { threadId: input.threadRef.threadId, terminalId, cwd: input.cwd },
  });
  if (opened._tag === "Failure") return; // toast with the error
  await input.writeTerminal({
    environmentId: input.environmentId,
    input: {
      threadId: input.threadRef.threadId,
      terminalId,
      data: `${input.runtime} logs --follow --tail 200 ${input.container.id}\r`,
    },
  });
}
```

This mirrors how upstream runs a project script in a new terminal
(`apps/web/src/components/ChatView.tsx:4170-4231`): `storeNewTerminal`, open, then write the
command followed by `\r`. The terminal UI store is global
(`apps/web/src/terminalUiStateStore.ts:563-585`: `ensureTerminal`, `setTerminalOpen`,
`newTerminal`, `setActiveTerminal`; `selectThreadTerminalUiState` at `:480`; verify its
signature and the `terminalIds` field name), and the terminal commands are `terminalEnvironment.open` and `.write`
(`apps/web/src/state/terminal.ts:5`). Terminal ids are free-form strings up to 128 chars
(`packages/contracts/src/terminal.ts:19`). The id is validated as hex before it reaches the
shell, and the runtime is a closed literal, so nothing user-controlled is interpolated.
Upstream authorizes `terminal.open` and `terminal.write` with `terminal:operate`; a token
without it gets upstream's authorization error, shown as a toast.

### Panel

`apps/web/src/fork/small-extras/containersPanel.tsx`: `ForkPanelDefinition` with id
`small-extras:containers`, title "Containers", icon `ContainerIcon` (lucide), shortcut `C`,
`description` "Docker and Podman containers, with their logs in the terminal." (the optional
`ForkPanelDefinition` field, shown by L12's picker), `unavailableHint` "Needs a Loom server",
`isAvailable` = thread present and `loomFeatures` has `small-extras` (the panel itself shows
"Needs a newer Loom server" when `info.parts` lacks `containers`). The `NoRuntime` state
links "CLI tools" to `/settings/loom#loom-small-extras`. The list refreshes on
mount, on the Refresh button, and every 10 seconds while the panel is mounted and the
document is visible.

## Part C: CLI tools

### Catalog

`apps/server/src/fork/small-extras/cliCatalog.ts`, plain data:

```ts
export interface CliToolDefinition {
  readonly id: string;
  readonly label: string;
  readonly category:
    | "source-control"
    | "javascript"
    | "python"
    | "languages"
    | "apple"
    | "containers"
    | "cloud"
    | "local-models"
    | "design-and-hardware"
    | "data"
    | "utilities";
  /** Names on PATH, or absolute paths (app bundles); the first found wins. */
  readonly executables: ReadonlyArray<string>;
  readonly versionArgs: ReadonlyArray<string>; // default ["--version"]
  readonly versionPattern?: RegExp; // capture group 1; default: first version-like token
  readonly installHint: string;
  readonly npmPackage?: string; // to match `npm outdated -g`
  /** Used instead of the detected manager's command when the real path contains the text. */
  readonly updateOverride?: { readonly whenRealPathIncludes: string; readonly command: string };
}
```

The list (Kyle's answer, 2026-09-24):

| Category            | Tools                                                                                                                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source-control      | git, gh, jj                                                                                                                                                                                                                                                                                    |
| javascript          | node, npm, pnpm, bun, vp (Vite+), wrangler (`npmPackage: "wrangler"`)                                                                                                                                                                                                                          |
| python              | python3, uv                                                                                                                                                                                                                                                                                    |
| languages           | rustc, cargo (`updateOverride` `rustup` -> `rustup update`), go (`versionArgs: ["version"]`)                                                                                                                                                                                                   |
| apple               | xcodebuild (`-version`), xcrun (`--version`), swift, xcodegen, fastlane, xcbeautify, swiftlint (`version`), mas (`version`), argent (`npmPackage: "@swmansion/argent"`, install hint `npm install -g @swmansion/argent`, from L09's references)                                                |
| containers          | docker, podman                                                                                                                                                                                                                                                                                 |
| cloud               | cloudflared, tailscale                                                                                                                                                                                                                                                                         |
| local-models        | ollama, lms (LM Studio CLI; executables `lms` and `~/.lmstudio/bin/lms`)                                                                                                                                                                                                                       |
| design-and-hardware | blender (also `/Applications/Blender.app/Contents/MacOS/Blender`), openscad (also `/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD` and the Nightly app, version on stderr, per L23), kicad-cli (also `/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli`, `versionArgs: ["version"]`) |
| data                | sqlite3, jq, yq                                                                                                                                                                                                                                                                                |
| utilities           | rg, fd, ffmpeg, op (1Password CLI), varlock, tsci (tscircuit), impeccable (`npmPackage: "impeccable"`)                                                                                                                                                                                         |

Checked on Kyle's Mac on 2026-09-24: xcbeautify, swiftlint, cloudflared, go and mas resolve
to Homebrew Cellar paths, blender to a Homebrew cask wrapper, wrangler to an npm global
under fnm's Node, and rustc and cargo to `rustup` proxies from Homebrew (hence the
`updateOverride`). argent, impeccable, openscad, kicad-cli, ollama and lms are not installed
there; their executable names, `versionArgs` and install hints are **unverified** and must be
checked against each tool's own `--help` or docs when implementing (a wrong guess shows as
"Error" with the probe's output, never a crash). Provider CLIs are excluded; the section
links to Settings, Providers, where upstream shows their versions and updates
(`apps/server/src/provider/providerMaintenance.ts`).

### Probe

For each tool (concurrency 6):

1. `resolveCommandPath(executable)` for names, `FileSystem.exists` for absolute paths (with
   `~` expanded); none found: `missing` with `installHint`.
2. `VcsProcess.run({ command: resolvedPath, args: versionArgs, cwd: config.cwd, timeoutMs: 5_000, maxOutputBytes: 8_000 })`
   (the same pattern as upstream's `SourceControlDiscovery.probe`,
   `apps/server/src/sourceControl/SourceControlDiscovery.ts:73-128`). Non-zero exit or
   timeout: `error` with the first line.
3. Version: `versionPattern` group 1, else the first match of
   `/v?(\d+(?:\.\d+){1,3}[0-9A-Za-z.+-]*)/` on stdout, then stderr (old Loom's
   `extractVersion` fallback).
4. Install manager from the real path (`FileSystem.realPath`):
   - `updateOverride` first, when its text is in the real path.
   - Homebrew: `homebrewOwnershipFromCommandPath` (exported,
     `apps/server/src/provider/providerMaintenance.ts:268-282`) gives formula or cask and
     name; update `brew upgrade [--cask] <name>`.
   - npm global: `npmGlobalPrefixFromCommandPath(realPath, npmPackage)` (`:232-250`) when the
     tool declares `npmPackage`; update `npm install -g <pkg>@latest`.
   - Bun global: real path under `~/.bun/`; update `bun add -g <pkg>@latest`.
   - macOS system: under `/usr/bin` or `/bin`; "Part of macOS".
   - Xcode: under `/Applications/Xcode*.app` or `/Library/Developer/CommandLineTools`;
     "Part of Xcode".
   - Otherwise "Unknown install", no command.
     Probe results are cached for 60 seconds in the service.

### Update check (on request)

`checkUpdates: true` additionally runs, in parallel, with 60 second timeouts:

- `brew outdated --json=v2` (reads Homebrew's local metadata; it does not run
  `brew update`, so results are as fresh as the last update, and the UI says so in
  PRODUCT.md's wording);
- `npm outdated -g --json` (asks the npm registry; exit code 1 means "something is
  outdated", not failure).

Matched by formula or cask name and npm package name to set `latestVersion` and
`updateAvailable`. Cached for one hour. A missing `brew` or `npm` just skips that source.

```ts
export const CliToolRow = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  category: Schema.String,
  status: Schema.Literals(["installed", "missing", "error"]),
  version: Schema.NullOr(Schema.String),
  path: Schema.NullOr(Schema.String),
  manager: Schema.Literals(["homebrew", "npm", "bun", "system", "xcode", "unknown"]),
  updateCommand: Schema.NullOr(Schema.String),
  latestVersion: Schema.NullOr(Schema.String),
  updateAvailable: Schema.NullOr(Schema.Boolean), // null until an update check ran
  detail: Schema.NullOr(Schema.String), // install hint or error line
  custom: Schema.Boolean,
});
export const CliToolsResult = Schema.Struct({
  tools: Schema.Array(CliToolRow),
  probedAt: IsoDateTime,
  updatesCheckedAt: Schema.NullOr(IsoDateTime),
});
```

## Agent-facing tools

None. Agents can run `which` and `--version` themselves; private mode reaches agents through
the turn instruction.

## Performance

- Part A and D naming: one lookup and a string replacement per first turn; the optional Jev
  call is bounded by its 1 second timeout and runs after text generation, off the turn's
  critical path.
- Part D per turn: the contributor and the Claude resolver read in-memory state; the commit
  check runs two or three short git commands after each turn of a private project only, with
  concurrency 2 across threads. Non-private threads cost one set lookup.
- The warnings subscription carries only warnings (rare, small payloads); clients never
  receive commit lists otherwise.
- Part B: one `ps` call per refresh, 10 second cadence only while the panel is visible;
  payload under 500 small rows. Logs flow through upstream's terminal stream, which already
  handles backpressure and scrollback.
- Part C: about 45 short processes on section open, bounded to 6 at a time, cached 60
  seconds; update checks only on click, cached an hour.
- Nothing animates.

## Alternatives considered

- **Prefix the temporary branch too.** Needs seams in `packages/shared/src/git.ts`,
  `ChatView.tsx` and mobile, and upstream's mobile app would keep creating `t3code/<hex>`
  anyway. Old Loom went further and persisted per-thread provenance (a migration plus
  projection changes across 44 files); far too heavy.
- **Add the prefix to upstream `ServerSettings`.** Forbidden: unknown keys are dropped and
  the file is rewritten (EXTENSION-POINTS.md, Persistence).
- **Write `.claude/settings.local.json` into private repositories** to turn off Claude's
  attribution. Writes into the work repository (it could be committed) and changes Kyle's
  manual Claude sessions there too. The SDK `settings` option is per session and leaves no
  file.
- **A git `commit-msg` hook (or `core.hooksPath` through the environment) that strips
  trailers.** Deterministic for every provider, but it writes into the repository or
  replaces the repository's own hooks (husky and the like). Rejected; the check suggests a
  command instead.
- **Rewriting commits automatically after a turn.** Changes history under the agent and the
  user, and breaks pushed branches. Rejected by Kyle's answer.
- **Codex `developer_instructions` seam** for the instruction. The uniform `ext-turn-input`
  block reaches every provider without a seam in `CodexSessionRuntime.ts`; revisit only with
  the Codex follow-up.
- **A fork log streamer** (`docker logs -f` over a streaming RPC into a custom viewer).
  More code and a new subscription for what the terminal already does well.
- **Old Loom's CLI registry** (about 6.3k lines: sandboxed execution, receipts, tool packs,
  risk policies). Only its declarative catalog and version extraction are kept.
