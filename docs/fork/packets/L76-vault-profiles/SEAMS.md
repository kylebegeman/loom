# L76 seams

## Implemented integration

All new implementation lives in fork-owned contracts, services, client-runtime and client
components. Existing core, RPC, settings, palette, CLI and MCP extension points register it.
The common provider instruction extension is reused without additional upstream changes.
The initial management milestone added no upstream seams. Launch integration now adds the
marked files listed below. Scheduled outcomes add a fork-owned SQLite migration; no production dependency is added.

The shared boundary is documented in [EXTENSION-POINTS.md](../EXTENSION-POINTS.md#loom-vault-foundation-ext-vault).
Other packets consume shared references/profiles, never this packet's UI internals.

## Remaining integration

Library publication, project-file discovery and additional consumers still require explicit integration design. They must not put credential values into turn events or bypass current
environment authority. Full packet acceptance remains open.

## Merge verification

The committed implementation is previewed with `git merge-tree` against the newest locally
available upstream nightly before handoff. The result and tag are recorded in TESTING.md.

## Launch integration seams

- `apps/server/src/orchestration-v2/ProviderTurnStartService.ts`: `ext-vault-preflight`, import and guard/failure settlement before session open.
- `apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts`: `ext-vault-preflight`, regression tests for blocked starts.
- `apps/server/src/orchestration-v2/ProviderTurnControlService.ts`: `ext-vault-preflight`, guard before steering delivery.
- `apps/web/src/components/chat/ChatComposer.tsx`: `vault-launch-ui`, import and attachment control.
- `apps/web/src/components/settings/ScheduledTasksSettings.tsx`: `vault-launch-ui`, import and scheduled-prompt control.
- `apps/mobile/src/features/threads/ThreadComposer.tsx`: `vault-launch-ui`, native composer control.
- `apps/mobile/src/features/settings/SettingsScheduledTasksRouteScreen.tsx`: `vault-launch-ui`, native scheduled-prompt control.

FORK.md and seams.tsv enumerate these markers. The blocking guard is independent of the
optional `ext-turn-input` contributor proposal because a required check cannot be skipped.

## Scheduled outcome seams

- `apps/server/src/scheduledTasks/ScheduledTaskService.ts`: `vault-scheduled-outcomes`, construct the fork service, track exact message ownership before dispatch, project task list/manual results and publish outcome changes through the existing scheduler.
- `apps/web/src/components/settings/ScheduledTasksSettings.tsx`: `vault-scheduled-outcomes`, import and review/retry recovery control.
- `apps/mobile/src/features/settings/SettingsScheduledTasksRouteScreen.tsx`: `vault-scheduled-outcomes`, import and capability-gated status/recovery guidance.

The SQLite ownership table and migration ledger are fork-owned. Portable declaration tools,
contracts and both transfer components use existing profile registrations and add no seams.

Retained-selection inspection and retirement reuse the existing fork profile/RPC/settings/CLI/MCP
registrations. This milestone adds no upstream seams, dependencies or SQL migrations.

GitHub bindings reuse existing profile contracts/services, fork provider guidance and web/native
settings/attachment controls. No new upstream seam, SQL migration or dependency is added.
