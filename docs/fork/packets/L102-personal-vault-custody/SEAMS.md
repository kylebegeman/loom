# L102 seams

## Status

Documentation only. No code, extension point or upstream seam is created by this packet.
`ext-personal-vault` is proposed. It must not be listed as an existing API. Existing fork
registries may carry coarse state; absent trusted custody must degrade to unavailable.

## Candidate implementation touchpoints

| Current path                                                | Intended use or constraint                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/settings/registry.ts:26`                 | Fork-owned status/setup entry; no factors in the web renderer.                                              |
| `packages/contracts/src/fork/identity.ts:5`                 | Existing login identity to distinguish from owner key authority; no required edit.                          |
| `apps/desktop/src/preload.ts:77`                            | Current bridge exposure. Optional desktop fork bridge would need the documented `ext-desktop` seam first.   |
| `apps/mobile/app.config.ts:216`                             | Existing keychain entitlement. Native custody capabilities require an explicit reviewed entitlement change. |
| `apps/desktop/src/settings/DesktopSavedEnvironments.ts:239` | Existing token decryption is evidence of a different trust boundary, not code to reuse for owner keys.      |

Future implementation belongs under fork-owned `personal-vault-custody` directories and a
reviewed native target. No such native target or build contract exists today. A new signed
helper, entitlements or package/build metadata is a proposed native seam whose exact inventory
must be settled after engine/topology selection. Do not invent a process launcher or IPC API.

## Packet seams and shared boundary ownership

Added packet seams: **none**. Prefer existing settings/palette/core registration for non-secret
status. A missing shared personal boundary is separately reviewable shared work; consumers do
not import another packet's internals. Any native upstream touch must be minimized, marked
`fork: personal-vault-custody` where syntax permits and recorded in `FORK.md` and `seams.tsv`.
JSON/build metadata seams require explicit no-marker rows. This packet adds none of those rows.

## Merge verification

No merge preview or integration rehearsal run for this proposed documentation. An implementing
agent records the actual target/tag and seam results once code exists. No fetch, install,
server start or deployment is needed to review this packet.
