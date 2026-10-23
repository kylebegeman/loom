# L109 seams

Status: Designing. No source changes, upstream edits or seam markers added.

## Extension points created by this packet

None created. Personal native/browser custody and recovery are **PROPOSED, not implemented**. Existing core/RPC, settings, palette, CLI and MCP registration points support safe coordination only. Server `ext-vault` and its backup proof do not supply independent personal recovery.

## Engine boundary

Read [L102's maintained-engine evaluation](../L102-personal-vault-custody/TECHNICAL.md#engine-format-and-keys), KDBX 4 first candidate, not selected. Actual engine bindings, native cache/backup/sync APIs and build/licensing seams require inventory. Existing registries and outer coordination receipts cannot create missing cryptographic integrity, per-device revocation or recovery authority. No custom format or cryptographic seam is proposed.

## Verified registration candidates

These are existing fork-owned registration locations, not upstream seams changed here:

| Current path and line                                                                                   | Candidate use                                          |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `packages/contracts/src/fork/index.ts:14`, `packages/contracts/src/fork/rpc.ts:76`                      | Safe receipt schemas/group only.                       |
| `packages/contracts/src/fork/clientRpcPermissions.ts:45`, `apps/server/src/fork/rpcAuthorization.ts:62` | Matching guarded RPC permissions.                      |
| `apps/server/src/fork/ForkLayer.ts:429`, `apps/server/src/fork/rpc.ts:116`                              | Service layer and thin transport handler registration. |
| `apps/server/src/fork/features.ts:10`, `packages/client-runtime/src/fork/capabilities.ts:13`            | Capability advertisement and graceful absence.         |
| `apps/server/src/fork/mcp/index.ts:33`, `apps/server/src/fork/cli/index.ts:8`                           | Metadata/outcome tools, never kit/export secret APIs.  |
| `apps/web/src/fork/settings/registry.ts:27`, `apps/web/src/fork/commandPalette/registry.ts:70`          | Recovery launch/status actions without private input.  |

## Packet seams and unknown native integration

Actual upstream seams: none. Future exact line counts and marked diffs require implementation inventory.

Inventory independently signed clean-device recovery distribution, macOS/iOS protected files and secure input, app/extension entitlements, Safari/Chromium launch/native messaging, removable-file access, print/share spool behavior, file protection/OS backup inclusion, cancellation after external writes and crash cleanup. Determine exact native targets, manifests, generated files, packaging and CI commands. These seams are **unknown**, not covered by an assumed desktop extension point.

Current `apps/desktop/src/electron/ElectronSafeStorage.ts:54` and `apps/mobile/src/persistence/mobile-secure-storage.ts:22` are string-storage primitives, not a personal recovery implementation. Current `apps/mobile/src/features/settings/SettingsEnvironmentDetailRouteScreen.tsx:206` hosts environment Vault settings; independently trusted personal restore must remain available when that environment is gone.

Future host adapters can stay under the proposed fork-owned paths in TECHNICAL.md. Document any unavoidable upstream edit with `fork: personal-vault-recovery`, exact counts and generated-file exceptions. Shared personal boundaries belong in the [umbrella](../LOOM-PERSONAL-VAULT.md) after review; [L108](../L108-personal-vault-sync/) and [L88](../L88-vault-recovery/) must not introduce circular registration or runtime dependencies.

## Merge check

Not run. No upstream fetch, merge-tree preview, application build or integration rehearsal was needed for this design-only work. Implementation records the actual reviewed nightly tag/result; clean-main post-merge rehearsal is the integrating owner's responsibility.

## FORK.md rows

None added or required. Future source seams require corresponding FORK.md and `docs/fork/seams.tsv` entries in the same implementation change. Neither file is in this task's write scope.
