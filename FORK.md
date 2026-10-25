# Loom fork notes

Loom is a personal fork of [T3 Code](https://github.com/pingdotgg/t3code). The fork is
additive: it tracks upstream and keeps upstream's internal names so merges stay easy.
The branding layer supplies the Loom display name, icon and primary CLI command. Existing
data locations, protocol names and compatibility identifiers remain upstream-compatible.

## Implementation packets

Loom features beyond the branding are built as implementation packets, one folder per
feature, each additive and limited to marked seams. Start at
[docs/fork/packets/README.md](docs/fork/packets/README.md) for the packet index, the
conventions and the shared extension points. The
[implement-now queue](docs/fork/packets/IMPLEMENT-NOW.md) records current selections and
takes precedence over older packet readiness labels; [docs/fork/selections.md](docs/fork/selections.md)
records which old Loom features were chosen.

L23's 3D editing workspace ships in Loom `0.0.46-nightly.20261007.2787` on `main`.
Its [packet](docs/fork/packets/L23-model-preview-3d/) records the completed scope and
verification limits; [user help](docs/fork/user/model-preview-3d.md) explains how to start.

L24's expanded PCB workspace ships in Loom `0.0.46-nightly.20261008.2801` on `main`.
Its [packet](docs/fork/packets/L24-pcb-preview/) records scope and verification;
[user help](docs/fork/user/pcb-preview.md) covers the editor, library, simulation and tools.

## Brand source

Fork-owned files, never edited upstream:

- `packages/shared/src/brand.ts`: `BRAND_NAME` ("Loom") and `formatBrandDisplayName`.
  Stable builds show "Loom", nightly builds "Loom (Nightly)", development builds
  "Loom (Dev)". The internal stage union (`Alpha | Dev | Nightly`) is unchanged; "Alpha"
  is upstream's stable stage and displays as the bare name. Covered by `brand.test.ts`.
- `apps/web/src/components/LoomWordmark.tsx`: the sidebar header wordmark. It inherits
  the header's size, weight, tracking and color, so it follows light, dark and the
  stage backdrop.
- `FORK.md`: this file.

## Product text

Text a person or an agent reads says Loom, or drops the product name where it adds nothing
("orangepi5pro did not answer"). Each reworded line in an upstream file carries `fork: brand`,
and the files are rows in `docs/fork/seams.tsv`. Comments, span names and identifiers keep
T3 names. Copy that exists only for T3 Connect is left for the
[Loom-owned connections](docs/fork/packets/LOOM-CONNECTIONS.md) work, which turns Connect off in
Loom builds.

Upstream merges keep adding "T3 Code" text. `scripts/fork/loom.sh check` fails on any
non-comment line in `apps/*/src` or `packages/*/src` that names it, outside tests, recorded
provider transcripts and T3's marketing site. The reviewed exceptions live in
`docs/fork/brand-copy-allowlist.tsv`: identifiers matched against existing data, names sent to
third parties, T3's triage playbook and Connect-only copy. Reword new lines; allowlist only real
identifiers.

## Seams in upstream files

Find them with `git grep -n "fork: brand"`; `docs/fork/seams.tsv` is the checked list.
JSON and binary files cannot carry the marker and are listed separately.

| File                                                          | Why                                                                                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/app/DesktopEnvironment.ts`                  | Base and display name from the brand file. Feeds `app.setName`, the About panel, window titles, the app menu, the Linux desktop entry and the web via IPC. |
| `apps/web/src/branding.ts`                                    | Web fallback base name when no desktop branding is injected.                                                                                               |
| `apps/web/src/branding.logic.ts`                              | Display-name policy delegates to the brand file (document title, auth, pairing and error screens).                                                         |
| `apps/web/src/components/sidebar/SidebarChrome.tsx`           | Header wordmark: `LoomWordmark` in place of the "T3" mark plus "Code".                                                                                     |
| `apps/web/index.html`                                         | Document title and splash labels shown before React mounts.                                                                                                |
| `scripts/build-desktop-artifact.ts`                           | Bundle product name (`Loom.app`, `CFBundleName`), DMG title, artifact file names, URL protocol display name, screen-capture usage text.                    |
| `apps/desktop/resources/dmg/dmg-background-*.svg`             | Installer artwork: "Drag Loom into Applications." and a Loom wordmark in place of the T3 mark.                                                             |
| `apps/web/src/branding.test.ts`                               | Expected fallback names.                                                                                                                                   |
| `apps/desktop/src/app/DesktopAppIdentity.test.ts`             | Expected app name.                                                                                                                                         |
| `scripts/build-desktop-artifact.test.ts`                      | Expected product name, DMG title and protocol name.                                                                                                        |
| `packages/shared/package.json` (no marker)                    | Adds the `./brand` subpath export as the first entry. If upstream also prepends an export, keep both entries with `./brand` first.                         |
| `assets/{prod,nightly,dev}/**` (no marker)                    | Loom icons under the upstream file names and dimensions. See Icons.                                                                                        |
| `apps/web/public/{favicon*,apple-touch-icon.png}` (no marker) | Development web icon copies generated by `icons:export`.                                                                                                   |
| Product text across `apps/*/src` and `packages/*/src`         | Reworded "T3 Code" copy (see Product text). Too many files to list here; `docs/fork/seams.tsv` has one `brand` row per file.                               |

L18 adds the approved `@env-spec/parser@0.6.0` server dependency for value-free env metadata.

### Extension point seams

The shared plumbing packets register into, specified in
[docs/fork/packets/EXTENSION-POINTS.md](docs/fork/packets/EXTENSION-POINTS.md). Find them with
`git grep -n "fork: ext-"`.

| File                                                                                            | Marker                      | Why                                                                                                         |
| ----------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/provider-core/src/server/orchestrationInstructions.ts`                                | `fork: ext-vault`           | Add capability-aware Vault guidance through existing provider instruction channels.                         |
| `apps/server/src/orchestration-v2/ProviderTurnStartService.ts`                                  | `fork: ext-vault-preflight` | Check explicit Vault launch requirements before opening a provider; settle blocked runs.                    |
| `apps/server/src/orchestration-v2/ProviderTurnControlService.ts`                                | `fork: ext-vault-preflight` | Recheck explicit Vault requirements before steering an active provider.                                     |
| `apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts`                             | `fork: ext-vault-preflight` | Prove explicit unavailable or invalid attachments never open a provider.                                    |
| `apps/server/src/ws.ts`                                                                         | `ext-core`                  | Serves `LoomWsRpcGroup` and merges the fork RPC handler layer.                                              |
| `apps/server/src/server.ts`                                                                     | `ext-core`                  | `ForkLayer`, given pull requests, heads the core runtime; `ForkRoutesLayer` with the routes.                |
| `apps/server/src/environment/ServerEnvironment.ts`                                              | `ext-core`                  | Advertises `capabilities.loomFeatures`.                                                                     |
| `packages/contracts/src/environment.ts`                                                         | `ext-core`                  | Optional `loomFeatures` capability key.                                                                     |
| `packages/client-runtime/src/rpc/protocol.ts`                                                   | `ext-core`                  | Clients speak `LoomWsRpcGroup`.                                                                             |
| `packages/client-runtime/src/rpc/client.ts`                                                     | `ext-core`                  | Fork streaming tags join the client's stream unions.                                                        |
| `packages/contracts/package.json` (no marker)                                                   | `ext-core`                  | `./fork` export and schema-free `./fork/model-check-limits` for geometry workers.                           |
| `apps/web/src/routes/__root.tsx`                                                                | `ext-web-root`              | Mounts `ForkRoot` in the authenticated app shell.                                                           |
| `apps/web/src/rightPanelStore.ts`                                                               | `ext-panels`                | The generic `"fork"` surface kind and the `openSurface` action.                                             |
| `apps/web/src/components/RightPanelTabs.tsx`                                                    | `ext-panels`                | Fork panels in the launcher and "+" menu; their tab titles and icons.                                       |
| `apps/web/src/components/ChatView.tsx`                                                          | `ext-panels`                | Renders fork panels, passes panel actions to both tab bars, and lets focusable canvases own keyboard input. |
| `apps/web/src/components/CommandPaletteContent.tsx`                                             | `library-palette`           | Allow the inline text editor to show its own keyboard hints.                                                |
| `apps/web/src/components/CommandPalette.tsx`                                                    | `ext-palette`               | Adds fork actions and hosts Library setup in the same searchable popup.                                     |
| `packages/contracts/src/keybindings.ts`                                                         | `ext-keybindings`           | Fork `loom.*` commands join the static keybinding command list.                                             |
| `apps/web/src/components/settings/KeybindingsSettings.logic.ts`                                 | `ext-keybindings`           | Fork feature names in keybinding labels, such as "Device QA".                                               |
| `packages/client-runtime/package.json` (no marker)                                              | `ext-core`                  | `./fork` subpath export, after `./errors`.                                                                  |
| `apps/web/src/components/settings/settingsSearch.ts`                                            | `ext-settings`              | Adds the Loom settings route, label and scope.                                                              |
| `apps/web/src/components/settings/SettingsSidebarNav.tsx`                                       | `ext-settings`              | Gives the Loom page its icon.                                                                               |
| `apps/web/src/routes/settings.loom.tsx` (fork-owned)                                            | `ext-settings`              | Hosts packet settings in the route directory.                                                               |
| `apps/web/src/routeTree.gen.ts` (generated)                                                     | `ext-settings`              | Regenerated by the web build to include the Loom route.                                                     |
| `apps/server/src/binCli.ts`                                                                     | `ext-cli`                   | Registers authenticated fork CLI commands; protects reference-completion stdout.                            |
| `apps/server/src/mcp/McpHttpServer.ts`                                                          | `ext-mcp`                   | Registers the fork's toolkits on the shared agent server.                                                   |
| `packages/contracts/src/clientRpcPermissions.ts`, `apps/server/src/auth/RpcAuthorization.ts`    | `ext-core`                  | Add fork client grants while preserving the exhaustive upstream server scope map.                           |
| `packages/client-runtime/src/state/runtime.ts`, `usage.test.ts`                                 | `ext-core`                  | Expose cancellable document results through the shared command boundary.                                    |
| `apps/server/src/observability/RpcInstrumentation.ts`                                           | `ext-core`                  | Label fork RPC spans within the shared middleware.                                                          |
| `apps/web/src/closedViewStore.ts`, `reopenClosedView.ts`                                        | `ext-panels`                | Persist and reopen fork documents; retire archived inspector history.                                       |
| `apps/web/src/components/DiffPanel.tsx`                                                         | `ext-diff-header`           | Fork buttons in the diff panel header, such as the code graph's Impact button.                              |
| `apps/web/src/components/chat/ChatComposer.tsx`                                                 | `ext-composer`              | Fork footer controls, prepended so upstream's from-the-end hiding keeps them; a drawer above the composer.  |
| `apps/web/src/composer-logic.ts`, `components/chat/ChatComposer.tsx`, `ComposerCommandMenu.tsx` | `ext-composer-menu`         | Fork items join the upstream `/` list and custom triggers, with selection routed to their source.           |

### Native Vault terminal connection seams

`fork: ext-vault-terminal` supplies a private session connection-file path to native
Codex shell configuration and Claude query environments. Provider-session rotation and cleanup
remove prior files; existing MCP credential revocation remains authoritative. Files are plaintext
with owner-only POSIX permissions, not same-user process isolation. See
[L85](docs/fork/packets/L85-vault-delivery/SEAMS.md).

| File                                                                | Purpose                                                        |
| ------------------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/provider-core/src/server/mcpSession.ts`                   | Optional connection path and shared environment helper.        |
| `packages/provider-core/src/server/McpProviderSessions.ts`          | Session-owned creation, replacement and cleanup.               |
| `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts`       | Thread-local shell environment configuration.                  |
| `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.test.ts`  | Native configuration regression coverage.                      |
| `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`      | Query-local terminal environment configuration.                |
| `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts` | Launched query environment regression coverage.                |
| `apps/server/src/orchestration-v2/ProviderSessionManager.test.ts`   | Await connection cleanup after the parallel shutdown deadline. |

### Development fixture seam

| File                                 | Marker         | Why                                                                                                                |
| ------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `apps/server/scripts/seed-dev-db.ts` | `dev-fixtures` | Permit recognized worktree fixture homes with live-state/symlink protection and atomic fixture marker publication. |

### Vault seams

| File                                                                         | Marker                     | Why                                                                                                                  |
| ---------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/secrets/SecretRequests.ts`                                  | `ext-vault`                | Bind private input transfers durably to an idempotent destination operation.                                         |
| `apps/server/src/secrets/SecretRequests.test.ts`                             | `ext-vault`                | Cover private transfer retries and cleanup failures.                                                                 |
| `apps/mobile/src/features/settings/SettingsEnvironmentDetailRouteScreen.tsx` | `vault-core`               | Mount Vault management in the selected computer's native settings.                                                   |
| `apps/server/src/scheduledTasks/ScheduledTaskService.ts`                     | `vault-scheduled-outcomes` | Exact scheduled-message ownership and task outcome projection; [L76](docs/fork/packets/L76-vault-profiles/SEAMS.md). |
| `apps/web/src/components/settings/ScheduledTasksSettings.tsx`                | `vault-scheduled-outcomes` | Review/retry controls for failed Vault-attached scheduled runs.                                                      |
| `apps/mobile/src/features/settings/SettingsScheduledTasksRouteScreen.tsx`    | `vault-scheduled-outcomes` | Capability-aware native outcome and recovery guidance.                                                               |

L79's OpenBao record foundation is in progress. See the [packet](docs/fork/packets/L79-vault-core/),
[user help](docs/fork/user/vault.md) and [operating guide](docs/fork/operations/vault.md).
No live deployment or personal credential migration is part of the foundation milestone.

### Dependencies added by packets

L23 adds `three` and `@types/three` 0.186.0 to `apps/web`, approved by Kyle on
2026-09-24. The renderer and loaders live in a lazy chunk loaded by the 3D panel.
The lockfile changes are limited to those packages and their required dependencies.

`apps/server` keeps `diff` 8.0.3 for the Apple build tooling's project patches. Upstream
dropped it in `v0.0.46-nightly.20261010.2935`; a seam row keeps the next merge from
removing it again.

`apps/web` keeps `jsdom` ^30.0.1, `react-test-renderer` 19.3.0 and
`@types/react-test-renderer` 19.1.0 for the fork's component tests in `src/fork/`.
Upstream moved its own DOM tests to the browser test project and dropped them in
`v0.1.1-nightly.20261018.3302`; seam rows keep the next merge from removing them again.
The renderer follows the web app's React version, which comes from the workspace catalog.

### Packet seams

L46 adds the print check worker to the server pack entries in `apps/server/vite.config.ts`
(`fork: model-print-check`) so the worker ships beside `bin.mjs`. The single-file executable
reports print checks as unavailable. See the
[L46 packet](docs/fork/packets/L46-model-print-check/SEAMS.md).

Upstream edits a single packet needs that no extension point covers. Each packet's `SEAMS.md`
explains why. Find them with `git grep -n "fork: <slug>"`.

L41 and L59 register turn chips through the changed files header extension in
`apps/web/src/components/chat/ChangedFilesTree.tsx` (`fork: ext-changed-files`, 2 marker
lines). Each chip gates its own feature. See the [extension point](docs/fork/packets/EXTENSION-POINTS.md#18-changed-files-card-header-ext-changed-files).

L24 adds an optional `extendEnv` flag to `apps/server/src/processRunner.ts`
(`fork: pcb-preview`) so circuit code receives only its filtered environment.
Existing callers retain inherited variables. See the
[L24 packet](docs/fork/packets/L24-pcb-preview/SEAMS.md).

L09 wraps DeviceWorkspace in `apps/web/src/components/device/DevicePanel.tsx`
(`fork: device-qa`, 2 marker lines) to put the Device QA toolbar row above the device
being viewed. The row renders nothing against a server without Device QA. See the
[L09 packet](docs/fork/packets/L09-device-qa/SEAMS.md).

L12 renders the right panel's empty-state launcher and the tab bar's "+" menu through
the Loom panel picker in `apps/web/src/components/RightPanelTabs.tsx` (`fork: panel-picker`,
6 marker lines). Both seams read upstream's own action arrays, and the "+" popover reuses
upstream's open state and trigger, so `rightPanel.new` still opens it. With the picker
turned off in Settings the upstream list and menu render unchanged. See the
[L12 packet](docs/fork/packets/L12-panel-picker/SEAMS.md) and
[user help](docs/fork/user/panel-picker.md).

L89 adds the Bots footer entry after Sites in `apps/web/src/components/sidebar/SidebarChrome.tsx`
(`fork: bots`, 4 marker lines since L94 added its attention count) and lists `/loom/bots` as a
utility page in `apps/web/src/components/sidebar/mainAppLocation.ts`. Bot runs are hidden threads: the subagent
checks in `apps/web/src/components/Sidebar.logic.ts` (2 marker lines),
`packages/client-runtime/src/state/threadShell.ts` and
`apps/web/src/components/ThreadNotificationCoordinator.tsx` also skip ids from
`isBotRunThreadId`. See the [L89 packet](docs/fork/packets/L89-bots-core/SEAMS.md).

L91 lists `LOOM_BOTS_INSTRUCTIONS` with the orchestration sections in
`packages/provider-core/src/server/orchestrationInstructions.ts` (`fork: bots`, 2 marker lines),
following the `ext-vault` seam there. Its composer features use `ext-composer` and
`ext-composer-menu`. See the [L91 packet](docs/fork/packets/L91-bots-invocation/SEAMS.md).

L95 renders a Bots section after the Totals section of `apps/web/src/components/usage/UsagePage.tsx`
(`fork: bots`, 2 marker lines). `BotsUsageSection` fetches its own numbers and renders nothing
unless the primary environment supports `bots-budgets` and is selected. See the
[L95 packet](docs/fork/packets/L95-bots-budgets/SEAMS.md).

L96 adds "Save as bot…" to the thread action menu in `apps/web/src/components/threadActionMenu.logic.ts`,
`apps/web/src/hooks/useThreadActionMenu.ts` and `apps/web/src/components/Sidebar.tsx` (`fork: bots`,
3 marker lines each). The item, its flag and its handler call one-line helpers in
`apps/web/src/fork/bots/fromThread/state.ts`. See the
[L96 packet](docs/fork/packets/L96-bots-from-thread/SEAMS.md).

L97 hands `bot-trigger-` webhook deliveries to the bot trigger service in
`apps/server/src/scheduledTasks/webhookRoute.ts` (`fork: bots`, 2 marker lines). The route takes
its scheduled task service from `BotTriggers.webhookTarget`, which routes bot hooks and returns the
service unchanged on a server without the fork layer.
The `ext-core` comment in `apps/server/src/server.ts` also gives `ForkLayer` the webhook origin.
See the [L97 packet](docs/fork/packets/L97-bots-triggers/SEAMS.md).

The thread inspector is archived in `apps/web/src/fork/thread-inspector/`. Its header
seam and UI registrations are removed.

The `codex-shadow-images` seam in `CodexHomeLayout.ts` and its regression tests
preserves Codex-created `generated_images` directories in account shadow homes.
Keep it during upstream merges until upstream accepts these directories without
preventing provider startup. The Pro Max account schema fix comes from upstream.

The `codex-login-email` seam in `CodexProvider.ts` names a Codex account from its
home's `auth.json` when a custom `model_provider` makes Codex report no account, so
usage views do not count a hub-routed subscription twice.

The `secure-session-cookies` seam in `apps/server/src/auth/utils.ts` (2 marker lines),
`http.ts` (6) and `http.test.ts` (3) marks browser session cookies `Secure` when a TLS
proxy forwards the request with `X-Forwarded-Proto: https`. The Library sits behind an edge
that also answers plain HTTP for its hostnames, so an unmarked session cookie set while
redeeming a pairing link would travel in clear text. Keep the seam until upstream marks
these cookies itself.

The `switchboard` seams add Switchboard mode (`apps/server/src/fork/switchboard`,
`apps/web/src/fork/switchboard`): one `switchboardEnabled` server setting, shown with
the usage hubs in Settings. While it is on, every Claude and Codex launch is pointed at
the CLIProxyAPI hub the owning server's `LOOM_SWITCHBOARD_URL` names, the local one by
default (`provider/codexLaunchArgs.ts`, `ClaudeAdapterV2.ts`, `CodexAdapterV2.ts`,
`ClaudeTextGeneration.ts`). A Codex thread resumed after the setting changes takes the
current route instead of the provider it was persisted with. The model picker shows one
Claude and one Codex (`ProviderModelPicker.tsx`), and provider status follows the route:
the drivers probe again when the setting changes, a routed Claude probe runs through the
hub and the key helper (`ClaudeDriver.ts`, `ClaudeProvider.ts`), and neither provider
reports its native login's allowances while routed (`CodexDriver.ts`, `CodexProvider.ts`).
Only Claude and Codex are routed; every other provider launches as upstream does.

Routed launches read the hub's client key through a key helper. Without
`LOOM_SWITCHBOARD_KEY_HELPER`, macOS runs `/usr/bin/security` and Linux runs
`/usr/bin/secret-tool` against the `switchboard` service's `client-api-key` entry. Other
platforms must set it to an absolute path of a command that prints the key, or routed
launches fail with a configuration error naming the setting. An invalid
`LOOM_SWITCHBOARD_URL` or helper path fails the same way rather than falling back to an
unrouted account.

Model availability comes from the Switchboard controller's cached `GET
/api/v1/availability`, read by the `loom.switchboard.limits` RPC. The local hub implies
the controller on `127.0.0.1:8318`; a remote hub needs `LOOM_SWITCHBOARD_CONTROLLER_URL`.
Only a model the controller reports `unavailable` is disabled, with the controller's
reason. A provider is limited as a whole only when every model listed for it is
unavailable or credit-only, and that limit also disables the provider's models the
controller does not list. The picker fails open: when the controller cannot answer, the
reading is stale or from a failed pass, no routed model is listed, or every listed model
is unknown, every model stays selectable and the picker says availability is unknown. A
routed hub with no known controller reports `unconfigured`: the picker says no controller
is configured, and Settings names `LOOM_SWITCHBOARD_CONTROLLER_URL`. The hub still
enforces each account's limits, and a turn reports any limit it hits. Limits views read
that hub's usage from the controller's cached `GET /api/v1/usage` instead of polling each
subscription (`usage/cliproxyApi.ts`), show it as unavailable rather than polling
providers when the controller is down or not configured, and ask it to collect again
after a reset credit is redeemed. Off, launches, status, usage and the picker are
upstream's.

The LoomOS integration pack for Omarchy workstations lives outside the app in
`deploy/omarchy`, with its implementation packets in `deploy/omarchy/packets` and
[user help](docs/fork/user/loom-os.md). `scripts/fork/loom.sh check` runs its tests.

The `respectful-notifications` seams come from LoomOS packet 07
(`deploy/omarchy/packets/07-respectful-actionable-notifications.md`) and
`apps/web/src/fork/respectful-notifications`. One `notificationPreviewsEnabled` client
setting, on by default, chooses between the thread or pull request title and a generic body
in system notifications, for thread alerts and review guide alerts
(`PullRequestGuideRunCoordinator.tsx`, 2 marker lines) alike. Its switch renders under Thread notifications in General settings
(`SettingsPanels.tsx`, `settingsSearch.ts`, `packages/contracts/src/settings.ts`).
`ThreadNotificationCoordinator.tsx` (18 marker lines) withdraws a notification once its
thread is answered, archived or removed, ignores clicks on stale ones, and delivers through
Web Locks so several windows on one origin show one notification. While the shell resyncs
after a reconnect nothing is known yet, so shown notifications stay and their clicks still
open the thread. Its two upstream tests mark the mock changes and the added cases.

`apps/server/scripts/migrate-dev-db.ts` (`fork: dev-db`, 8 marker lines) skips the Loom
tables listed in `apps/server/src/fork/devDb.ts` when it copies the real database. Their
rows name the live install's lanes, run folders and graphs, and a dev server reconciling
them would release leases, clear scratch or delete files that belong to the live install.
Add a table there when a feature stores host resources it later cleans up. The same helpers
rebuild the Library's full-text search tables in the copy and stop copied bot work, so a dev
server never runs the developer's bots.

L05 adds the outline toggle and column to the file viewer in
`apps/web/src/components/files/FilePreviewPanel.tsx` (`fork: file-outline`, 3 marker
lines). See the [L05 packet](docs/fork/packets/L05-file-outline/SEAMS.md) and
[user help](docs/fork/user/file-outline.md).

The `no-project-first` seams put **No project** first in every new-chat picker and keep it off
a Library. A Library with execution turned off still advertises a scratch folder, so
`apps/web/src/hooks/useScratchProject.ts` (4 marker lines) picks the target through
`packages/client-runtime/src/fork/no-project-target.ts`: the current computer, then the
primary, then the first by name that can run work. `CommandPalette.tsx` (1 marker line)
replaces upstream's second-place row in **New thread in...** and labels its computer.
`DraftHeroHeadline.tsx` (10 marker lines) adds the row to the draft heading's project menu,
which widens `ProjectEnvironmentBadge.tsx` (2 marker lines) to accept one computer, and
`useLogicalProjectEnvironments.ts` (2 marker lines) keeps a No project draft from moving to
a Library. Upstream's own scratch checks stay in `scratchWorkspaceRootFor`, which still
recognises scratch projects on computers that cannot run them. `Sidebar.tsx` (5 marker lines)
keeps its New thread button enabled when No project or a Library is the only way to start,
and starts No project when there is no project to start in. `DesktopWebLinkCoordinator.tsx`
(2 marker lines) keeps `file:` links on the primary, since their path names that machine.

On mobile, `NewTaskRouteScreen.tsx` (8 marker lines) moves the No project row above the
Library and local projects, shows it whenever a computer can run it, and names that computer.
`new-task-flow-provider.tsx` (2 marker lines) and `usePromptLinkResolver.ts` (2 marker lines)
filter the scratch draft's computer list and prompt-link candidates through
`noProjectWorkspaceRoot`, so neither offers a Library. `createWorkspaceStackNavigator.ios.tsx`
(1 marker line) sends the iOS compose button to the New task picker unless a Library project
is on screen.

L112 `identity-renewal` seams let desktop and iPhone renew Identity sessions on their own. On the
server, `SessionStore.ts` (17 marker lines) links a renewed session to the one it replaces and
revokes the whole chain, and `ws.ts` (11) moves an open socket to the successor at expiry. In
client-runtime, `registry.ts` (13), `resolver.ts` (6) and `layer.ts` (2) renew expired or
rejected Identity credentials and forget a computer's grant on removal. Desktop adds the renew
and forget bridge in `main.ts`, `preload.ts`, `channels.ts` and `DesktopIpcHandlers.ts` (2 to 3
each) and `packages/contracts/src/ipc.ts` (3); `apps/web/src/connection/platform.ts` (3) and
`apps/mobile/src/connection/platform.ts` (2) provide each client's renewal. Mobile Settings
(`SettingsEnvironmentDetailRouteScreen.tsx`, 1) shows the renewal copy, and
`packages/shared/package.json` exports `./fork/identity-grant` (no marker). See the
[L112 packet](docs/fork/packets/L112-identity-renewal/SEAMS.md).

The `retention-defaults` seams bound storage that otherwise grows without limit. Browser
captures default to 14 days in `packages/contracts/src/settings.ts` (1 marker line), and
`EventNdjsonLogger.ts` (1) halves the provider log cap to 256 MiB. `LocalDeviceHost.ts` (2)
prunes device QA session folders idle for 14 days before it starts the device daemon, and
`UsageService.ts` (3) deletes usage scan caches from older versions a week after their last
write, with a pointer in `usageScanCache.ts` (1). Both helpers live in
`apps/server/src/fork/retention/`. Tests carry the rest: `settings.test.ts` (3),
`LocalDeviceHost.test.ts` (3), and one each in `EventNdjsonLogger.test.ts`,
`UsageService.test.ts`, `serverSettings.test.ts`, `storageCleanup.test.ts` and
`packages/shared/src/serverSettings.test.ts`.

The `deleted-history` seam frees the space deleted conversations hold. `runtimeLayer.ts` (2
marker lines) wraps the effect executor so `attachment.cleanup` waits while the Library still
needs a bound thread's deletion. `apps/server/src/fork/deleted-history/` then purges each thread
deleted more than 24 hours ago down to its `thread.created` and `thread.deleted` events and its
thread row, once the Library has acknowledged the deletion or the thread was never bound, and
the Library history source refuses to send a purged thread again. `Orchestrator.ts` (4) refuses
a fork or merge-back whose source or target is deleted, because a purge may already be emptying
the runs it would copy.

The `server-weight` seams cut trace volume and background database work on long-running
computers. `serverActivation.ts` (4 marker lines) and `Scheduler.ts` (2) start each parked
fiber and scheduler pass in its own trace through
`apps/server/src/fork/tracing/withoutParentSpan.ts`, instead of growing the startup trace for
the server's life. History compaction in `ProjectionMaintenance.ts` (11) and space reclaim in
`DatabaseStorage.ts` (7) run their per-page statements untraced under one span per pass that
carries the counts. `Sqlite.ts` (1) drops the constant `db.name` and `service.name` attributes
from every statement, and `packages/shared/src/observability.ts` (3) collapses SQL whitespace
before truncating. `ThreadSettlementService.ts` (11) reuses one settings read per sweep until
settings change and asks for a storage sweep only once a settled thread is done with its
worktree, which lets the lane watchdog cache ready lanes. `ServerBrowserContexts.ts` (1) caps
the preview browser's disk cache at 128 MiB. Tests carry the rest: `FoundationPersistence.test.ts`
(8), `ThreadSettlementService.test.ts` (6), `DatabaseStorage.test.ts` (4),
`Scheduler.test.ts` (3) and `observability.test.ts` (2).

L113 `directory-computers` seams list the Library directory's unsaved computers on desktop, web
and iPhone and connect each with Loom Identity. `ConnectionsSettings.tsx` (7 marker lines) opens
the pairing form for a Library row with its address, passes the computer's environment ID to
remote and SSH connections so a wrong computer is refused, hides the form's unpinned Identity
sign-in for that row, and clears the row's address when the form closes. iPhone's
`ConnectionsNewRouteScreen.tsx` (4) does the same for its pairing form through a
`libraryComputer` route param. See the
[L113 packet](docs/fork/packets/L113-directory-computers/SEAMS.md).

L114 `reach` seams publish a computer's public reach address, `https://<name>-loom.<zone>/`,
once its Library has set up a Cloudflare tunnel for it. `packages/contracts/src/server.ts` (1
marker line) adds `public` to `ServerDirectEndpointKind`, which older clients drop through
`ForwardCompatibleArray`. `DirectEndpoints.ts` (3) reads the fork `ReachPublicRoute` with
`Effect.serviceOption`, so upstream tests need nothing, and appends the address while the
connector runs. `server.ts` (2) provides that route right after `DirectEndpoints.layer`,
which sits below ForkLayer and cannot see fork services. Web `ConnectionsSettings.tsx` (2) and
iPhone `SettingsEnvironmentDetailRouteScreen.tsx` (2) mount the reach section in a saved
computer's details, and `packages/shared/package.json` exports `./fork/reach` (no marker).
Saved connections keep no resource pin: every Identity sign-in applies a stateless rule from
`packages/shared/src/fork/identityGrant.ts`, so no connection seam is needed. The request guard
on the reach hostname is a global middleware merged into `ForkRoutesLayer`, so it needs no
upstream line. See the [L114 packet](docs/fork/packets/L114-reach/SEAMS.md).

`confirm-label` seams let a confirmation name its action ("Turn off", "Remove") instead of
"Confirm": `ConfirmDialogOptions.confirmLabel` in `packages/contracts/src/ipc.ts` (1), carried
through `apps/web/src/confirmDialog.ts` (7) and rendered by `ConfirmDialogHost.tsx` (2). Desktop
uses the same in-app dialog, so it needs no seam. Unset keeps "Confirm".

L115 `library-push` seams let a Loom iPhone build register with its Library for push
notifications without Connect. `apps/mobile/app.config.ts` (2 marker lines) keeps
`aps-environment` when `LOOM_MOBILE_LIBRARY_PUSH_ENABLED=1` and exposes `extra.loomLibraryPush`,
while upstream's relay and widget push paths stay off. `App.tsx` (2) mounts the fork
registration coordinator next to `SubscriptionUsageCoordinator`.
`SettingsNotificationsRouteScreen.tsx` (3) returns the Library notifications screen before
upstream's own early return in a build without Connect config, and appends the Library section
to the Connect variant. `SettingsRouteScreen.tsx` (2) adds a Notifications row to the Local
settings variant, which has none. `use-remote-environment-registry.ts` (2) asks the Library to
forget the phone before the iPhone's Remove revokes the session that request needs. The Library
server, web and the rest of the iPhone work are fork-owned. See the
[L115 packet](docs/fork/packets/L115-push/SEAMS.md).

L116 `telemetry-off` seams stop Loom sending product analytics to T3. `AnalyticsService.ts` (1)
defaults `T3CODE_TELEMETRY_ENABLED` to off, so the server sends PostHog events only when it is
set to `true`, and `docs/user/telemetry.md` says so. See the
[L116 packet](docs/fork/packets/L116-connect-off/SEAMS.md).

L116 `connect-off` seams retire T3 Connect on builds the publisher makes with
`LOOM_CONNECT_RETIRED=1`, which it sets only when `connect.json` says `"enabled": false`.
`apps/server/vite.config.ts` (1) bakes it as `__LOOM_CONNECT_RETIRED__`; dev runs, tests and
builds made without the variable never retire. On a retired build the fork-owned
`apps/server/src/fork/connect-off/` layer runs when ForkLayer builds. It clears every stored
Connect secret and the T3 CLI sign-in and keeps the key pair and replay markers.
`apps/server/src/cloud/http.ts` (3) refuses `link-proof` and `relay-config` with a 403, so a
client that still has Connect cannot re-link the computer; unlink still works. The cleanup runs
before an update trial activates, so a retired trial that rolls back leaves the restored
Connect-on runtime unlinked until it is linked again. The publisher passes the flag to the CLI
runtime archive workflow as its `connect_retired` input, so CLI-hosted computers retire with the
same release. See the [L116 packet](docs/fork/packets/L116-connect-off/SEAMS.md).

## Loom CLI and pairing copy

User-facing pairing instructions and CLI help use Loom. The server package exposes `loom`
alongside its compatibility executable, and new pairing credentials are labelled `Loom pairing`.
Desktop command settings now install `loom`; existing `t3` launchers and package aliases remain
compatible. Stored connection identifiers are unchanged. No global command was installed during
this task. Package-runner examples keep the actual upstream npm package name; do not substitute
`npx loom`, which could fetch an unrelated package.

| File                                                                | Marker      | Why                                                                   |
| ------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| `apps/mobile/src/features/layout/AdaptiveWorkspaceLayout.tsx`       | `library`   | Route sidebar source actions through the Library project launch flow. |
| `apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx` | `brand`     | Loom pairing instructions in the scanner.                             |
| `apps/web/src/components/onboarding/WelcomeWizard.tsx`              | `brand`     | Loom CLI pairing/start examples.                                      |
| `apps/server/src/binCli.ts`                                         | `brand`     | Loom CLI root/help naming.                                            |
| `apps/server/src/cli/pair.ts`, `pair.test.ts`, `app.test.ts`        | `brand`     | Loom server errors and new credential labels.                         |
| `apps/server/package.json`                                          | (no marker) | Add the `loom` executable alias.                                      |

| `apps/desktop/src/app/DesktopCliCommand.ts` | `brand` | Install, inspect and remove the Loom command without replacing unrelated executables. |
| `apps/desktop/src/app/DesktopCliShim.ts` | `brand` | Use the Loom launcher filename; preserve legacy shim ownership and runtime identifiers. |
| `apps/desktop/src/app/DesktopCliCommand.test.ts` | `brand` | Exercise installation, ownership, PATH shadowing and removal under the Loom name. |
| `apps/desktop/src/app/DesktopCliShim.test.ts` | `brand` | Verify moved-install messaging uses Loom. |
| `apps/server/src/cli/invocation.ts` | `brand` | Suggest Loom for direct invocations; keep actual npm package runner specs compatible. |
| `apps/server/src/cli/invocation.test.ts` | `brand` | Verify direct Loom invocations alongside actual package runner and launcher paths. |
| `apps/server/src/cli/server.ts` | `brand` | Use Loom in server command help and unknown-command examples. |
| `apps/web/src/components/settings/CliCommandSettingsRow.tsx` | `brand` | Describe the installed Loom command and actionable PATH errors. |
| `apps/web/src/components/settings/settingsSearch.ts` | `brand` | Discover the Loom command setting by its product name. |
| `apps/web/src/components/settings/SourceControlSettings.tsx` | `brand` | Recommend Loom GitHub setup in connection guidance. |

| `apps/mobile/src/features/connection/ConnectionEnvironmentRow.tsx` | `brand` | Loom account and connection labels in native pairing/management. |
| `apps/mobile/src/features/connection/CloudEnvironmentRows.tsx` | `brand` | Loom account and connection labels in native pairing/management. |
| `apps/mobile/src/features/connection/GitHubRoutingSettings.tsx` | `brand` | Loom account and connection labels in native pairing/management. |

`LOOM_SERVER_SELF_UPDATE=false` stops the server from updating its own runtime
(`fork: runtime-owner`). LoomOS sets it because its signed releases ship the runtime, and a
second updater would replace it. The server then omits `serverSelfUpdate` from its descriptor,
in desktop mode too, refuses every direct update request and desktop update commit before it
looks at the launcher or the desktop app, and `t3 update` refuses too, each with a reason that
names the operating system. It also omits `serverInstallation`, or an older client would build
an npm install command that replaces the operating system's runtime. An older client still
falls back to its `npx t3@<version>` relaunch command, which no descriptor value can stop;
only clients that know the owner show the operating system instead. The descriptor carries
`capabilities.serverRuntimeOwner: "operating-system"`. That is a separate optional field, not
a `serverSelfUpdate` literal: every client decodes that set as closed, so a new literal would
make older clients reject the descriptor, while an unknown owner decodes as absent. Clients
read it through `runtimeManagedByOperatingSystem` in
`packages/client-runtime/src/fork/capabilities.ts` and name the operating system, usually with
`OS_MANAGED_RUNTIME_NOTE`, wherever they would offer an update or relaunch command: web's
update action, ChatView's version banner, Connections, the update banner, Update everything
and Fleet, mobile's computer settings, and the protocol mismatch message. Agents and Mini jobs
on such a host inherit the switch, so `selfUpdateSwitch.setup.ts` clears it before every server
test. `false`, `no`, `off` and `0` turn it off; any spelling effect's `Config.Boolean`
rejects stops the server from starting. The service launcher does not read the switch: an
operating system's `t3 service install` rewrites the launcher state, which clears any update
accepted earlier. The setting lives in
`apps/server/src/fork/runtime-owner/selfUpdateSwitch.ts`; `docs/fork/seams.tsv` lists the
marked files.

L72 shares dev server ports as preview links (`fork: preview-links`). The web preview
resolves a URL through `navigablePreviewUrlFor` before loading it, so a loopback port the
client cannot reach becomes a link and a link becomes a fresh single-use entry:
`apps/web/src/browser/browserTargetResolver.ts` (5 marker lines) and its test (15),
`apps/web/src/browser/openFileInPreview.ts` (4),
`apps/web/src/components/preview/openPreviewSession.ts` (5),
`apps/web/src/components/preview/openTerminalLinkInPreview.ts` (5) and
`apps/web/src/components/preview/PreviewView.tsx` (9).
`apps/web/src/components/preview/PreviewLocalServerCard.tsx` (3) adds the copy and open
buttons to each server, and `apps/web/src/localApi.ts` (3) opens a link in the system browser
through a fresh entry. A thread's links that leave for the system browser open a port this
client cannot reach through a link: `apps/web/src/browser/useOpenLink.ts` (2),
`apps/web/src/components/ChatMarkdown.tsx` (4) and
`apps/web/src/components/ThreadTerminalDrawer.tsx` (2). On mobile,
`apps/mobile/src/Stack.tsx` (2),
`apps/mobile/src/features/settings/components/settings-sheet-targets.ts` (1) and
`apps/mobile/src/features/settings/SettingsRouteScreen.tsx` (1) add the Previews screen,
`apps/mobile/src/lib/openExternalUrl.ts` (2) opens preview links leaving the app through a
fresh entry, and a thread's links open the same way from chat
(`apps/mobile/src/native/useOpenPullRequest.ts`, 2), an html_render page
(`apps/mobile/src/features/threads/HtmlRenderWebView.tsx`, 4), an MCP app
(`apps/mobile/src/features/threads/McpAppWebView.tsx`, 2) and the Files markdown preview
(`apps/mobile/src/features/files/FileMarkdownPreview.tsx`, 2). See the
[L72 packet](docs/fork/packets/L72-preview-links/SEAMS.md) and
[user help](docs/fork/user/preview-links.md).

## Identifiers kept on purpose

These locate the owner's existing T3 Code data or are invisible, so they keep T3 names:

- App id `com.t3tools.t3code` (and the Windows AppUserModelId).
- userData folder `~/Library/Application Support/t3code` (`t3code-dev` in development),
  including upstream's legacy `T3 Code (Alpha)` folder detection.
- State directory `~/.t3`, env vars `T3CODE_*`, localStorage keys `t3code:*`, and
  package names `@t3tools/*`.
- URL schemes `t3code` and `t3code-dev`; only their display name changed.
- The packaged `package.json` name `t3code`. Electron names the macOS Keychain item
  after it (see below).
- Linux executable name and WM class `t3code`; `apps/desktop/package.json` `productName`,
  which only names the unpackaged development Electron process.
- The default branch `main`, as upstream's. Upstream's scripts, docs and workflow
  triggers assume it.
- The CLI update source in `packages/shared/src/cliRelease.ts`.
- Upstream's `T3Wordmark` component, still used by the work-log "T3 Code" icon and the
  first-run welcome wizard. The wizard is skipped for existing workspaces.

## safeStorage and the Keychain

Electron encrypts its cookie store and `safeStorage` data with a key kept in the macOS
Keychain item `<app name> Safe Storage`. The name is bound during startup from the
packaged `package.json` (`name: "t3code"`, no `productName`), before the app's own
`app.setName` call runs. That is why the installed T3 Code (Alpha) created
`t3code Safe Storage`, not `T3 Code (Alpha) Safe Storage`.

The fork changes only `productName` in the electron-builder config and the runtime
display name, and leaves the packaged `package.json` name alone, so Loom uses the same
`t3code Safe Storage` item and existing cookies stay readable. Adding a `productName` to
the staged `package.json` would move the key to `Loom Safe Storage`, an item that a
different app named Loom already created on this Mac. Don't add one.

The app encrypts two files with `safeStorage`: `~/.t3/userdata/saved-environments.json`
(saved remote environment bearer tokens) and `~/.t3/userdata/connection-catalog.json`
(the desktop connection catalog). Neither existed when this fork was made.

A locally built, unsigned app has a different code signature from the T3 release that
created the Keychain item, so macOS may ask once whether Loom can use
`t3code Safe Storage`. Allow it to keep existing cookies. That prompt comes from the
signature, not from the rename.

## Icons

The desktop build turns `assets/<flavor>/*-macos-1024.png` into `icon.icns` with `sips`
and `iconutil`. It doesn't use the Icon Composer projects or build an `Assets.car`.
The `app-icon.icon` projects are the source for `vp run icons:export` (iOS, Linux,
Windows `.ico` and web exports) and for the mobile iOS build.

- Each `app-icon.icon` has one flat, glass-free layer, `Assets/loom.png`: the Loom icon
  body cropped from its macOS rendition and scaled to 1024px. The old layer SVGs stay in
  place because `scripts/export-android-icons.ts` still reads them, so the Android
  launcher artwork is still T3.
- The iOS, universal, web favicon, apple-touch and `.ico` files are generated by
  `vp run icons:export`; `vp run icons:check` passes.
- The macOS 1024px PNGs are the Loom icon's own macOS rendition from its `.icns`
  (848px body, 88px inset, no shadow), copied in place of the manual Icon Composer
  "macOS pre-Tahoe" export described in `assets/README.md`.
- `assets/prod/logo.svg` is unchanged. No build uses it.

## Updating from upstream

Loom follows upstream's nightlies, so `main` takes small upstream steps every day instead
of a large one per stable release. The `Loom upstream` workflow
(`.github/workflows/loom-upstream.yml`) runs every morning. When upstream has a nightly
that `main` lacks, it merges it on `integrate/<tag>`, runs the fork's checks and opens a
pull request. A pull request that passes on the first try merges by itself and `main` is
tagged `loom-<tag>` (the repository variable `LOOM_AUTO_MERGE`). If the merge conflicts or
a check fails, Claude (Opus 5.5, high effort) repairs it on the same branch within the
seam rules and says what it changed on the pull request. When it cannot, the run opens a
draft marked "needs Kyle" with its report, so a failed day never passes silently. Those
pull requests wait for review, and each new integration pull request closes the older ones
whose upstream tag it already contains.

Nothing installs by itself. Feed-enabled builds use the existing update button: download
the update, then restart and install when ready. The local publisher described below builds
and publishes each checked daily integration automatically.

For a manual build, run this from Terminal, not from inside Loom: installing quits Loom,
and `land` refuses to run where that would kill it midway.

```sh
scripts/fork/loom.sh land
```

`land` merges an open integration pull request with a merge commit and tags `loom-<tag>`
if the workflow has not. With nothing open it tags `main` as it is with the next Loom
version, which covers fork changes. Either way it then refreshes and runs the publisher
(waiting for a scheduled run to finish first) and installs the published build, so a
landed build is the same release the update button offers. It stops early when the
installed build is already `main`. Never squash or rebase an integration pull
request: the next merge needs upstream's history, and `land` stops if it finds the tag
missing from `main`. To take a stable release or a specific tag, run the workflow by hand
(Actions, Loom upstream, Run workflow, target `stable` or a tag) or
`gh workflow run loom-upstream.yml -f target=stable`; `dry_run` merges and checks without
pushing. Mention `@claude` in any pull request comment to have Claude work on that branch
(`.github/workflows/loom-claude.yml`, owner only).

The same steps run locally with `scripts/fork/loom.sh`:

| Command                                          | What it does                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `scripts/fork/loom.sh status`                    | The upstream release main is built from, the installed version, and the newest stable and nightly tags.                   |
| `scripts/fork/loom.sh check`                     | The fork's checks on the current checkout: seams, fork lint, fork tests, Omarchy pack checks, web build, typechecks.      |
| `scripts/fork/loom.sh integrate`                 | Merge the newest stable tag on a test branch, check and build it, then fast-forward main, tag, push, publish and install. |
| `scripts/fork/loom.sh integrate nightly`         | The same for the newest nightly tag, or pass any upstream tag.                                                            |
| `scripts/fork/loom.sh integrate <tag> --dry-run` | Merge, check and build, then discard it. main and the installed app are unchanged.                                        |
| `scripts/fork/loom.sh integrate <tag> --pr`      | Merge and check, then push the test branch and open its pull request (what the workflow runs).                            |
| `scripts/fork/loom.sh land [<pr>]`               | Merge an integration pull request, or tag main's fork changes, then publish and install.                                  |
| `scripts/fork/loom.sh build` / `install`         | Build main to verify it, without keeping it / install the newest published build.                                         |
| `scripts/fork/loom.sh rollback`                  | Reinstall the previous published build and restore the T3 data it last ran with.                                          |

A merge conflict stops on the `integrate/<tag>` branch and lists the files. Resolve them,
`git add -A && git commit --no-edit`, then `scripts/fork/loom.sh integrate --continue`
(add `--pr` to finish as a pull request).

Fork features that reach `main` join the next daily integration build. To install them
before then, use `scripts/fork/loom.sh land` from Terminal.

### Automatic builds and the update button

On Kyle's Apple Silicon Mac, the local publisher checks GitHub every 30 minutes while
logged in. It builds the newest `loom-v*` integration tag contained in `origin/main`, in
an isolated checkout under `~/Library/Application Support/Loom Updates`. It does not
pull, stash or reset the working checkout. A failed or unmerged integration is not a
release candidate. Publication versions belong to Loom: each new source gets the next
patch above its immutable published version tags, independently of the upstream version.
The genuine upstream `v*` tags and merge commits stay intact.

```sh
node scripts/fork/updates.ts publish
node scripts/fork/updates.ts enable
```

The first command builds, signs and publishes the current integration. `enable` installs
the publisher and its launch agent outside the checkout, so switching branches does not
break the schedule. Run `enable` again after changing the publisher. `check` reports the
candidate without building or publishing; `prepare` builds without publishing; `status`
shows the service and log locations; `disable` removes the schedule.

The signing key stays in the Mac's login keychain. The publisher verifies that the built
app uses `kylebegeman/loom` as its feed and satisfies the installed app's signing
requirement. It signs before creating the final ZIP and checksum, uploads to a draft
GitHub Release, then publishes only after the ZIP, block map and manifest have uploaded.
Re-running a published integration does nothing. Sleeping or offline Macs catch up on
the next successful check. Logs are in `~/Library/Logs/Loom Updates.log`.

Older Loom builds have no feed. After the first `publish`, run
`scripts/fork/loom.sh install` once from Terminal to install the prepared build. Subsequent
releases appear in the app's normal update controls; downloading and restarting remain
manual. GitHub releases are for this Mac, not notarized public macOS distribution.

The publisher retains three completed builds plus the installed build. Scripted installs
make the database snapshots used by `loom.sh rollback`; the standard in-app updater does
not make those legacy snapshots. Do not assume every in-app update has a rollback snapshot.

### Versions and updates

The automatic publisher assigns Loom an independent, increasing patch version. A
checked `loom-v*` tag selects the source; its name does not determine the published app
version. An immutable bare-version tag reserves that version for the source commit, so
retries reuse it. An integration annotation can carry `loom-release=<version>` for an
explicit release version and `upstream=v<version>` for genuine upstream provenance.
Minor or major version changes require Kyle's explicit approval.

The app and bundled server share the Loom publication version. Build records store that
in `version`, the candidate tag in `integration`, the actual upstream tag in `upstream`,
and the exact source in `commit`. Older records used `upstream` for the app version and
remain readable. `loom.sh status` reports the real merged upstream tag. Only the
publisher makes installable builds: `integrate` and `land` run it, `install` and
`rollback` choose among its published records, and `build` keeps nothing. So the update
button, scripted installs, TestFlight and the runtime archives always share one version.

Standalone remote `t3` installers still use upstream's CLI release catalog. Loom's own
publication version is not an upstream archive coordinate; consult its recorded upstream
provenance when selecting upstream source, and check host capabilities for Loom features.
The `-nightly.<date>.<run>` suffix selects the "Loom (Nightly)" name and icon; a stable
version builds plain "Loom".

Loom's feed is `kylebegeman/loom`, never `pingdotgg/t3code`: both apps share an app id,
so an upstream feed would replace Loom. Both the local build script and publisher reject
an app with the wrong feed. Published release tags use the plain Loom version without a
leading `v`: unlike `loom-v*`, these are semantic versions the GitHub updater can discover,
and they stay out of the sync scripts' upstream tag selection. Do not add `+` build
metadata to those tags: GitHub encodes it in the Atom feed, and the updater rejects the
encoded version. Upstream's tags and merge history are never rewritten.

### GitHub Actions on the fork

Actions were off when the fork was created, GitHub's default for forks, and upstream's
workflows must stay off here: they try to publish a release every half hour, deploy the
relay and build mobile apps with upstream's accounts, and they run on paid Blacksmith
runners the fork does not have. Only `loom-*.yml` workflows run. The
first step of every `Loom upstream` run disables any other active workflow, including ones
a merge adds, and the default workflow token is read-only.

The workflows need two repository secrets:

- `CLAUDE_CODE_OAUTH_TOKEN`: from `claude setup-token`, so Claude runs on Kyle's Claude
  subscription.
- `LOOM_BOT_TOKEN`: a fine-grained personal access token for `kylebegeman/loom` only, with
  read and write access to Contents, Pull requests and Workflows. The built-in token cannot
  push the upstream workflow changes most merges carry. It expires; renew it when runs fail
  to push.

The repository variable `LOOM_AUTO_MERGE` is `true`, which lets the workflow merge an
integration pull request that passed without repairs. Set it to anything else and every
pull request waits for `land`.

Builds live in `~/Library/Application Support/Loom Builds` (the newest three, plus the
installed one). Each scripted install first saves the V1 `state.sqlite`, the V2 `statev2.sqlite`
(when present), and the settings files from `~/.t3/userdata` into the record of the build
being replaced. Rollback restores the saved databases and removes a V2 database when
returning to a V1-only snapshot. Nightly builds share stable's data
folder and may upgrade the database in ways an older build cannot read, which is why a
rollback restores the data along with the app. Threads created on the newer build are
lost by a rollback.

Builds are signed with a local certificate, "Loom Local Code Signing", that
`scripts/fork/loom.sh signing-setup` creates once in the login keychain. It gives every
build the same identity (`identifier "com.t3tools.t3code" and certificate leaf = ...`),
so macOS keeps Loom's permissions and Keychain access across updates; without it each
build is a new ad hoc app. The certificate is self-signed and only for this Mac: it is
not trusted elsewhere and cannot notarize. The first build after setup may ask to let
`codesign` use the key, and Loom may ask once for the `t3code Safe Storage` item;
choose Always Allow for both.

## Merging upstream

Conflicts should only appear on seam lines. `docs/fork/seams.tsv` lists every seam file,
its marker and how many marked lines it keeps; `scripts/fork/loom.sh check` fails when a
merge drops one, or when a marker appears that the manifest does not list. A change that
adds or moves a seam updates the manifest in the same commit.

### Shared computer connections

Loom reuses upstream Connect identity, discovery and relay protocols. Shared host names
use the existing signed descriptor and config stream. The local publisher freezes
explicit public Connect configuration for desktop, iOS and exact-source CLI archives.
See [Connections help](docs/fork/user/connections.md).

| File                                                                         | Marker              | Why                                                                        |
| ---------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------- |
| `apps/mobile/app.config.ts`                                                  | `fleet-connect`     | Restore configured Connect authentication and exact Loom runtime delivery. |
| `apps/mobile/src/Stack.tsx`                                                  | `fleet-connections` | Unify computer work, routes and access in Connections.                     |
| `apps/mobile/src/features/cloud/publicConfig.test.ts`                        | `fleet-connect`     | Restore configured Connect authentication and exact Loom runtime delivery. |
| `apps/mobile/src/features/cloud/publicConfig.ts`                             | `fleet-connect`     | Restore configured Connect authentication and exact Loom runtime delivery. |
| `apps/mobile/src/features/connection/ConnectionEnvironmentRow.tsx`           | `computer-naming`   | Publish and project the canonical computer name.                           |
| `apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx`          | `fleet-connections` | Unify computer work, routes and access in Connections.                     |
| `apps/mobile/src/features/connection/ConnectionsRouteScreen.tsx`             | `fleet-connections` | Unify computer work, routes and access in Connections.                     |
| `apps/mobile/src/features/connection/LocalEnvironmentList.tsx`               | `fleet-connections` | Unify computer work, routes and access in Connections.                     |
| `apps/mobile/src/features/connection/useConnectionController.ts`             | `computer-naming`   | Publish and project the canonical computer name.                           |
| `apps/mobile/src/features/keyboard/CommandPalette.tsx`                       | `fleet-connections` | Unify computer work, routes and access in Connections.                     |
| `apps/mobile/src/features/projects/AddProjectScreen.tsx`                     | `fleet-connections` | Unify computer work, routes and access in Connections.                     |
| `apps/mobile/src/features/projects/AddProjectSourceRoute.tsx`                | `fleet-connections` | Unify computer work, routes and access in Connections.                     |
| `apps/mobile/src/features/settings/SettingsAuthRouteScreen.tsx`              | `fleet-connect`     | Restore configured Connect authentication and exact Loom runtime delivery. |
| `apps/mobile/src/features/settings/SettingsEnvironmentDetailRouteScreen.tsx` | `computer-naming`   | Publish and project the canonical computer name.                           |
| `apps/mobile/src/features/settings/SettingsEnvironmentDetailRouteScreen.tsx` | `fleet-connections` | Unify computer work, routes and access in Connections.                     |
| `apps/mobile/src/features/settings/SettingsEnvironmentDetailRouteScreen.tsx` | `fleet-connect`     | Manage the selected computer’s account link.                               |
| `apps/mobile/src/features/cloud/linkEnvironment.ts`                          | `fleet-connect`     | Reuse host linking with explicit delivery preferences.                     |
| `apps/mobile/src/features/cloud/ConnectOnboardingRouteScreen.tsx`            | `fleet-connect`     | Keep onboarding guidance consistent with native computer linking.          |
| `apps/mobile/src/features/cloud/linkEnvironment.test.ts`                     | `fleet-connect`     | Cover scoped host linking and preserve notification setup behavior.        |
| `apps/mobile/src/features/settings/SettingsEnvironmentsRouteScreen.tsx`      | `fleet-connections` | Unify computer work, routes and access in Connections.                     |
| `apps/mobile/src/features/settings/SettingsRouteScreen.tsx`                  | `fleet-connections` | Unify computer work, routes and access in Connections.                     |
| `apps/mobile/src/state/remote-environment-projections.test.ts`               | `computer-naming`   | Publish and project the canonical computer name.                           |
| `apps/mobile/src/state/remote-environment-projections.ts`                    | `computer-naming`   | Publish and project the canonical computer name.                           |
| `apps/server/src/environment/ServerEnvironment.ts`                           | `computer-naming`   | Publish and project the canonical computer name.                           |
| `apps/server/src/ws.ts`                                                      | `computer-naming`   | Publish and project the canonical computer name.                           |
| `apps/web/src/cloud/publicConfig.ts`                                         | `connect-compat`    | Restore configured Connect authentication and exact Loom runtime delivery. |
| `apps/web/src/components/settings/ConnectionsSettings.tsx`                   | `fleet-connections` | Unify computer work, routes and access in Connections.                     |
| `apps/web/src/components/settings/settingsSearch.ts`                         | `fleet-connections` | Unify computer work, routes and access in Connections.                     |
| `apps/web/src/state/environments.ts`                                         | `computer-naming`   | Publish and project the canonical computer name.                           |
| `packages/client-runtime/src/relay/discovery.test.ts`                        | `computer-naming`   | Publish and project the canonical computer name.                           |
| `packages/client-runtime/src/relay/discovery.ts`                             | `computer-naming`   | Publish and project the canonical computer name.                           |
| `packages/client-runtime/src/state/presentation.ts`                          | `computer-naming`   | Publish and project the canonical computer name.                           |
| `scripts/lib/public-config.test.ts`                                          | `fleet-connect`     | Restore configured Connect authentication and exact Loom runtime delivery. |
| `scripts/lib/public-config.ts`                                               | `fleet-connect`     | Restore configured Connect authentication and exact Loom runtime delivery. |
| `apps/mobile/src/features/connection/GitHubRoutingSettings.tsx`              | `fleet-connections` | Describe host sharing using the computer terminology.                      |
| `packages/shared/src/cliRelease.test.ts`                                     | `fleet-connect`     | Restore configured Connect authentication and exact Loom runtime delivery. |
| `packages/shared/src/cliRelease.ts`                                          | `fleet-connect`     | Restore configured Connect authentication and exact Loom runtime delivery. |
| `packages/ssh/src/tunnel.test.ts`                                            | `fleet-connect`     | Restore configured Connect authentication and exact Loom runtime delivery. |
| `packages/ssh/src/tunnel.ts`                                                 | `fleet-connect`     | Restore configured Connect authentication and exact Loom runtime delivery. |

### Machine update seams

| File                                                        | Packet            | Why                                                  |
| ----------------------------------------------------------- | ----------------- | ---------------------------------------------------- |
| `apps/web/src/components/ProviderUpdatesAction.tsx`         | `machine-updates` | Scope provider updates to permitted computers.       |
| `apps/web/src/components/sidebar/SidebarUpdatePill.tsx`     | `machine-updates` | Keep the footer local to the desktop computer.       |
| `apps/web/src/components/sidebar/useUpdateEverything.ts`    | `machine-updates` | Share scoped local and fleet update execution.       |
| `apps/web/src/components/sidebar/updateEverything.logic.ts` | `machine-updates` | Keep local and fleet progress in their owning views. |

### Secure native randomness

| File                                          | Marker                 | Why                                                                                                                                |
| --------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/src/features/cloud/dpop.ts`      | `secure-native-random` | Fail closed when native secure randomness is unavailable; Expo's convenience byte API can fall back to Math.random in development. |
| `apps/mobile/src/features/cloud/dpop.test.ts` | `secure-native-random` | Cover unavailable secure randomness without using the available insecure fallback.                                                 |
