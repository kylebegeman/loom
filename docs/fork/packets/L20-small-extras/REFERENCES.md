# L20 references

## Old Loom

Selection F23 ("Small extras").

### Worktree branch prefix

- Ledger [1362](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/1362-port-configurable-worktree-prefixes-and-codex-runtime-identity.md):
  ported from upstream PRs #3948 and #3954, bundled with an unrelated Codex change; 44 files.
- [settings.ts](https://github.com/bagelvault/loom/blob/a79ec506/packages/contracts/src/settings.ts)
  lines 422-427: `DEFAULT_WORKTREE_BRANCH_PREFIX = "loom"` and the `WorktreeBranchPrefix`
  validation regex. **Keep** the regex.
- [git.ts](https://github.com/bagelvault/loom/blob/a79ec506/packages/shared/src/git.ts)
  lines 47-210: prefix normalization, temporary-branch extraction with persisted provenance,
  generated names. **Drop**: the provenance column (migration
  `161_TemporaryWorktreeBranchProvenance`) and its threading through decider, projector and
  snapshot queries is the bulk of the 44 files.
- [ThreadsSettingsPanel.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/settings/ThreadsSettingsPanel.tsx)
  lines 152-170: settings row with normalize-on-commit and reset. **Adapt** the UX.

### Container logs

- [ContainerLogTail.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/containerLogs/Layers/ContainerLogTail.ts)
  (341 lines) and [ContainerLogsSurface.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/code/ContainerLogsSurface.tsx):
  **Drop.** It read a `container_log_lines` table that nothing in production wrote
  (`appendLines` had only test callers) and was scoped to old Loom's sandbox runs; it never
  called `docker logs`.
- [DockerStackManager.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/previewDevEnvironment/Layers/DockerStackManager.ts)
  lines 119-159 and 276-293: the only real Docker CLI use,
  `docker compose -f <file> -p <name> ps --format json` with array-or-NDJSON parsing and
  State/Health mapping. **Adapt** the tolerant parser idea.

### CLI tool registry

- [CliToolRegistry.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/cliTools/Layers/CliToolRegistry.ts)
  (4220 lines): catalog `builtInCliTools` at lines 1023-2111 (node, jq, pandoc, libreoffice,
  ffmpeg, imagemagick, pdftotext, sqlite3, playwright, curl, mermaid, archives, ripgrep, IDE
  bridges), probe at 2340-2460 (5 second timeout, scrubbed env, 64 KB cap),
  `extractVersion` at 556-565. **Keep** the declarative catalog shape and version extraction.
  **Drop** sandboxed execution, risk policies, approvals, run receipts, tool packs, the four
  tables (`cli_tool_*`). It never looked up latest versions.
- [cliTools.ts](https://github.com/bagelvault/loom/blob/a79ec506/packages/contracts/src/cliTools.ts)
  (766 lines) and [CliToolsSettings.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/settings/CliToolsSettings.tsx)
  (682 lines): reference only.
- Ledger entries 0551, 0553, 0555, 0557, 0562 (`.ledger/entries/05xx-*.md` in the old
  repository): the registry's history.

## Upstream T3 Code

| Path                                                                                                                          | Why                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/git.ts:13-20,95-109`                                                                                     | Prefix constant, temporary pattern, builders.                                                                           |
| `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:17,185-206,877-936`                                           | Generated name and first-turn rename; the seam site (line 914); rename steps reused by `renamePrivateBranch` (914-925). |
| `apps/server/src/provider/Layers/ClaudeAdapter.ts:118,4210,4235,4703-4710,4742,4787`                                          | Claude Agent SDK query options; the `settings` object and the part D seam site.                                         |
| `apps/server/src/provider/Layers/ProviderService.ts:1569-1672`                                                                | `sendTurn`, where `ext-turn-input` adds the private mode block.                                                         |
| `packages/contracts/src/orchestration.ts:1492-1498,1813,1874`                                                                 | `thread.activity.append`, `thread.turn-start-requested`, `thread.turn-diff-completed` (with `checkpointTurnCount`).     |
| `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:217,235`                                                   | `getThreadShellById`, `getTurnStartMessage`.                                                                            |
| `apps/server/src/git/GitWorkflowService.ts:108`                                                                               | `renameBranch`.                                                                                                         |
| `apps/server/src/checkpointing/Utils.ts:4`, `apps/server/src/vcs/GitVcsDriverCore.ts:3243`                                    | Hidden local refs (`refs/t3/checkpoints`, `refs/t3code/pre-refresh`).                                                   |
| `apps/web/src/components/ui/toast.tsx:42-69,79,806-812`, `apps/web/src/session-logic.ts:451-515`                              | Toast data (secondary action, expandable content) and generic activity rows.                                            |
| `packages/effect-codex-app-server/src/_generated/schema.gen.ts`                                                               | Codex app-server schema: no attribution option (grep, 2026-09-24).                                                      |
| `apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts:298,471,680`                                             | Existing rename coverage.                                                                                               |
| `apps/web/src/components/ChatView.tsx:7935`, `apps/mobile/src/state/use-thread-outbox-drain.ts:956`                           | Where clients pick temporary branch names (unchanged).                                                                  |
| `apps/server/src/orchestration/Layers/CheckpointReactor.ts:553`, `apps/web/src/components/GitActionsControl.logic.ts:405-406` | Temporary-branch checks that must keep working.                                                                         |
| `apps/server/src/git/GitManager.ts:277`, `apps/server/src/sourceControl/BitbucketApi.ts:525`                                  | Hardcoded `t3code/pr-...` branch names (kept as upstream names; no seam).                                               |
| `apps/server/src/vcs/GitVcsDriverCore.ts:3056-3058`                                                                           | Worktree directory derived from the branch name.                                                                        |
| `packages/contracts/src/terminal.ts:19,40-48`, `packages/contracts/src/rpc.ts:327-333`                                        | Terminal ids and RPCs.                                                                                                  |
| `apps/web/src/terminalUiStateStore.ts:20-27,480,563-585`                                                                      | Terminal UI store used to open a logs tab.                                                                              |
| `apps/web/src/components/ChatView.tsx:892-893,4170-4231`                                                                      | How a project script opens a terminal and writes a command.                                                             |
| `apps/web/src/state/terminal.ts:5`                                                                                            | `terminalEnvironment`.                                                                                                  |
| `packages/shared/src/shell.ts:619-627`, `apps/server/src/os-jank.ts:20-51`                                                    | Command resolution and login-shell PATH.                                                                                |
| `apps/server/src/sourceControl/SourceControlDiscovery.ts:16-128`                                                              | Probe-table pattern for `--version` checks.                                                                             |
| `apps/server/src/provider/providerMaintenance.ts:232-282,351-475,635-682`                                                     | Homebrew and npm ownership detection, latest-version lookups for providers.                                             |
| `apps/web/src/components/settings/settingsLayout.tsx:268`, `SettingsPanels.tsx:2831-2858`                                     | Settings row and draft input patterns.                                                                                  |

## External

- Claude Code settings reference, `attribution` and `includeCoAuthoredBy`
  (https://code.claude.com/docs/en/settings-reference, fetched 2026-09-24): empty `commit`
  and `pr` plus `sessionUrl: false` hide all attribution; `includeCoAuthoredBy` is deprecated
  since v2.0.62; `--settings` ranks below managed settings and above project and user files.
  Matches `@anthropic-ai/claude-agent-sdk` 0.3.260 `sdk.d.ts` (`Options.settings`,
  `Settings.attribution`).
- Codex configuration reference (https://developers.openai.com/codex/config-reference,
  fetched 2026-09-24): no attribution key documented. The codex-cli 0.156.1 binary contains a
  `<git_attribution>` developer instruction with `Co-authored-by: Codex <noreply@openai.com>`
  and a `commit_attribution_enabled` value (source unverified); `codex features list` shows
  `codex_git_commit` as removed. Open upstream discussion:
  https://github.com/openai/codex/issues/19799.
- Jev API and jev-1.13 guidance (https://docs.typesafe.ai/api,
  https://docs.typesafe.ai/model-jaggedness/jev-1.13): Choice question and answer shapes,
  literal criteria.
- git `rebase --exec`, `--rebase-merges`, `commit --amend --reset-author`
  (https://git-scm.com/docs/git-rebase, https://git-scm.com/docs/git-commit).

- Docker CLI `docker ps --format` and `docker logs --follow --tail`
  (https://docs.docker.com/reference/cli/docker/container/ls/,
  https://docs.docker.com/reference/cli/docker/container/logs/).
- Podman `podman ps --format json`, `podman logs --follow --tail`
  (https://docs.podman.io/en/latest/markdown/podman-ps.1.html).
- Docker Compose labels `com.docker.compose.project`, `.service`, `.project.working_dir`
  (set by Compose v2; unverified for every Podman compose setup, hence reading
  `io.podman.compose.project` too).
- Homebrew `brew outdated --json=v2` (https://docs.brew.sh/Manpage#outdated-options).
- npm `npm outdated -g --json` (https://docs.npmjs.com/cli/commands/npm-outdated).
