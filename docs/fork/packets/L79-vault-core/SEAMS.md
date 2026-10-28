# L79 seams

## Shared extension

`ext-vault` provides contracts, backend/domain services, private handoff and client commands.
It uses existing fork RPC, service, settings, MCP and CLI registries. Those registries are
fork-owned and require no upstream seams. The extension specification records exact contracts
and existence checks; packet consumers do not import another packet's UI.

| Upstream file                                                                | Marker       | Purpose                                                                                          |
| ---------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| `apps/web/src/components/chat/SecretRequestCard.tsx`                         | `vault-core` | Mount private-card save and saved-item answer controls.                                          |
| `apps/mobile/src/features/threads/SecretRequestCard.tsx`                     | `vault-core` | Mount native private-card save and saved-item answer controls.                                   |
| `apps/server/src/mcp/toolkits/orchestrator/tools.ts`                         | `ext-vault`  | Guide saved-item use through the existing private request card.                                  |
| `packages/client-runtime/src/state/commandPermissions.test.ts`               | `ext-core`   | Check that saved-item answers require the destination access-write scope.                        |
| `apps/server/src/secrets/SecretRequests.ts`                                  | `ext-vault`  | Destination-bound private transfer and decoded files; existing consume retains one-use behavior. |
| `apps/server/src/secrets/SecretRequests.test.ts`                             | `ext-vault`  | Retry, competing-destination and failed-cleanup behavior coverage.                               |
| `apps/mobile/src/features/settings/SettingsEnvironmentDetailRouteScreen.tsx` | `vault-core` | Import and render the fork-owned native settings section.                                        |

The private handoff seam adds an optional claim to existing private-source records; it does not
migrate their contents or change stored provider sessions. The native settings and private-card seams import and mount fork components.
FORK.md and docs/fork/seams.tsv track these files.
No package dependency, SQL migration, generated route or desktop IPC seam is added.

## Merge verification

Run the seam-only manifest validation and a merge-tree preview after committing the milestone.
No upstream fetch, merge, push or deployment is implied. Current code is additive outside these
marked seams; results and verification limits belong in TESTING.md.
