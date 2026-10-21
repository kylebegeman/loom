# L107 seams

## Current state

Documentation only; no code/config or extension point changed, and no FORK.md or seam-manifest rows added. The proposed personal native boundary is absent. `ext-desktop` is documented in EXTENSION-POINTS.md but was not found in the inspected source; verify its exact current state before use.

## Expected fork-owned additions

Packet-owned contracts/atoms, setup/status components, desktop companion launcher and native config-plugin sources. Existing fork settings/palette/mobile registries can register metadata UI. An actual native credential provider is a new native target, not a JavaScript-only screen.

## Candidate upstream inventory

| Existing file                                | Reason to examine                                                               | Required treatment if changed                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/mobile/app.config.ts`                  | Register credential-provider plugins/extension entitlement and Android services | Minimal `fork: personal-vault-native` insertion; generated native files come from the plugin. |
| `apps/desktop/src/ipc/DesktopIpcHandlers.ts` | Optional companion launch/status bridge                                         | Prefer a verified `ext-desktop`; create shared plumbing separately if needed.                 |
| `apps/desktop/src/preload.ts`                | Optional typed nonsecret bridge                                                 | Same extension; no generic native command or reveal bridge.                                   |
| `packages/contracts/src/ipc.ts`              | Optional desktop bridge type                                                    | Keep shared extension member optional; no changes to upstream auth semantics.                 |
| `apps/desktop/src/preview/Passkeys.ts`       | Prevent overlap between existing browser ceremonies and any personal provider   | Preserve existing flow; change only if an actual integration is necessary and inventoried.    |

New native manifests, entitlements, signing/bundle identifiers and packaging inputs are not yet approved or enumerated. Inspect the generated-target conventions and official platform requirements before naming exact changes. JSON/plist/binary seams unable to carry markers need explicit manifest/FORK.md entries; do not claim zero seams in a shipped provider. New production dependencies/infrastructure need applicable authorization, not a silent addition.

## Verification record

No code merge preview or main integration rehearsal run for this design. Implementation records actual files, markers/minimum marked lines, exact nightly tag and merge result, then main-only rehearsal after landing.
