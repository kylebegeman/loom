# L106 seams

## Current state

Design documents only. No extension point, code seam, manifest entry or FORK.md row has been added by this packet. The personal authority/executor boundary is proposed, not available by inference from `ext-vault`.

## Planned fork-owned integrations

Existing `apps/server/src/fork/ForkLayer.ts`, `apps/server/src/fork/mcp/index.ts`, `packages/contracts/src/fork/rpc.ts`, `packages/contracts/src/fork/clientRpcPermissions.ts`, and web settings/palette registries can register metadata services. Add packet-owned contracts, service, atoms and UI only after inspecting current registries. Reusing these fork-owned files is not an upstream seam.

## Upstream areas to inventory before implementation

| Candidate existing file                            | Why an insertion may be needed                                        | Proposed handling                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/preview/Manager.ts`              | Session ownership, cancellation and partition teardown                | Prefer a separate trusted executor; do not hook personal fill into ordinary preview. Only inventory this file if a defensible reuse is proven. |
| `apps/server/src/mcp/toolkits/preview/handlers.ts` | Ensure ordinary evaluate cannot reach private login or approval pages | Enforce outside the agent's process first. A UI/MCP deny rule alone is insufficient.                                                           |
| `apps/desktop/src/ipc/DesktopIpcHandlers.ts`       | Optional trusted-client IPC bridge                                    | `ext-desktop` is specified but not present in the inspected checkout; verify and create an approved minimal extension separately if needed.    |

These are review areas, not approved changes or line-count promises. Any required upstream insertion gets `fork: personal-vault-agents` or the exact shared-extension marker, plus matching FORK.md and `docs/fork/seams.tsv` rows in the implementation commit. Native isolation may need a different process/app entirely; settle that before advertising capability.

## Merge evidence

No merge preview or main integration rehearsal run for this documentation-only proposal. The implementing agent records the exact nightly tag, command/result and actual marked seams after code exists. No fetch or full fork check is needed to author these documents.
