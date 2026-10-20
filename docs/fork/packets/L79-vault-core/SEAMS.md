# L79 seams

## Shared extension

`ext-vault` provides contracts, backend/domain services, private handoff and client commands.
It uses existing fork RPC, service, settings, MCP and CLI registries. Those registries are
fork-owned and require no upstream seams. The extension specification records exact contracts
and existence checks; packet consumers do not import another packet's UI.

| Upstream file                                                                | Marker       | Purpose                                                                                   |
| ---------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| `apps/server/src/secrets/SecretRequests.ts`                                  | `ext-vault`  | Destination-bound idempotent private transfer; existing consume retains one-use behavior. |
| `apps/server/src/secrets/SecretRequests.test.ts`                             | `ext-vault`  | Retry, competing-destination and failed-cleanup behavior coverage.                        |
| `apps/mobile/src/features/settings/SettingsEnvironmentDetailRouteScreen.tsx` | `vault-core` | Import and render the fork-owned native settings section.                                 |

The private handoff seam adds an optional claim to existing private-source records; it does not
migrate their contents or change stored provider sessions. The native settings seam is one
import and one component expression. FORK.md and docs/fork/seams.tsv track all three files.
No package dependency, SQL migration, generated route or desktop IPC seam is added.

## Merge verification

Run the seam-only manifest validation and a merge-tree preview after committing the milestone.
No upstream fetch, merge, push or deployment is implied. Current code is additive outside these
marked seams; results and verification limits belong in TESTING.md.
