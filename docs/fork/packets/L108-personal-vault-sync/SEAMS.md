# L108 seams

Status: Designing. Documentation only; no source changes or seam markers added.

## Extension points created by this packet

None created. The personal custody/browser/native extension boundary is **PROPOSED and unimplemented**. Existing `ext-core`, `ext-settings`, `ext-palette`, `ext-cli` and `ext-mcp` registrations can carry safe status; their existence does not establish personal isolation. Existing `ext-vault` is server-readable development storage.

## Engine boundary

Read [L102's maintained-engine evaluation](../L102-personal-vault-custody/TECHNICAL.md#engine-format-and-keys), KDBX 4 first candidate, not selected. Actual engine bindings, native cache/backup/sync APIs and build/licensing seams require inventory. Existing registries and outer coordination receipts cannot create missing cryptographic integrity, per-device revocation or recovery authority. No custom format or cryptographic seam is proposed.

## Verified registration candidates

These are current fork-owned locations, not upstream seams or changes made here:

| Current path and line                                                                                   | Potential registration                                                          |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/index.ts:14`, `packages/contracts/src/fork/rpc.ts:76`                      | Export proposed schemas and merge RPC group.                                    |
| `packages/contracts/src/fork/clientRpcPermissions.ts:45`, `apps/server/src/fork/rpcAuthorization.ts:62` | Protected mutation scopes and matching server checks.                           |
| `apps/server/src/fork/ForkLayer.ts:429`, `apps/server/src/fork/features.ts:12`                          | Relay layer and capability registration after implementation.                   |
| `apps/web/src/fork/settings/registry.ts:27`, `apps/web/src/fork/commandPalette/registry.ts:70`          | Safe status and launch actions only.                                            |
| `packages/client-runtime/src/fork/vault-core.ts:43`                                                     | Existing environment command/query pattern, not personal custody code to reuse. |

## Packet seams and native unknowns

Actual upstream seams: none. No exact future upstream line count is claimed.

Inventory native app signing/update trust, macOS key access and user-presence enforcement, isolated client storage, background/sleep locking, iOS protected storage and lifecycle, Safari extension/App Group entitlements, Chromium extension/native messaging installation, browser permissions and packaging. Locate build manifests, generated projects and entitlements before proposing paths or marked diffs. These seams are currently **unknown**, including whether a new independently signed target is required.

`apps/desktop/src/electron/ElectronSafeStorage.ts:54` and `apps/mobile/src/persistence/mobile-secure-storage.ts:22` are verified primitives to assess, not approved custody seams. `apps/mobile/src/features/settings/SettingsEnvironmentDetailRouteScreen.tsx:206` currently renders development Vault settings; a personal feature must not accidentally inherit environment-local trust from it. Existing desktop IPC documentation is a proposal, not evidence of a secure personal broker.

Future fork-owned candidates are listed in TECHNICAL.md. Prefer existing registries for host UI; enumerate any unavoidable upstream touches with `fork: personal-vault-sync` markers, generated-file exceptions and exact line counts during implementation. Coordinate shared extension changes through the [umbrella](../LOOM-PERSONAL-VAULT.md), not duplicated packet-specific adapters.

## Merge check

Not run. Documentation creates no code seams. No upstream fetch, merge preview, build or integration rehearsal was performed. Implementation must record the actual reviewed nightly tag and focused result; full post-merge rehearsal belongs to the authorized clean-main stage.

## FORK.md rows

None added or needed for this design-only change. Future real seams require FORK.md and `docs/fork/seams.tsv` entries in the same implementation change, outside this packet's present write scope.
