# L86 testing

## First milestone automated acceptance

Seven focused files pass **48 tests**, including request/grant lifecycle tests, fork MCP startup
registration, authentication binding, RPC scope coverage, feature registration, destination
permission revocation and temporary-window contract validation. The five affected package
typechecks pass: server, web, mobile, client-runtime and contracts. Focused lint/format, native
mobile static checks, documentation links, seam inventory and whitespace checks also pass.
An additional focused SSH regression suite passes 11 tests after its fixture construction was
updated for the notification adapter. No repository-wide checks ran.

```sh
./node_modules/.bin/vp test run apps/server/src/fork/vault/VaultAccess.test.ts apps/server/src/fork/vault/access-mcp.test.ts apps/server/src/fork/mcp/registration.test.ts apps/server/src/fork/rpcAuthorization.test.ts apps/server/src/fork/features.test.ts packages/client-runtime/src/fork/vault-access.permissions.test.ts packages/contracts/src/fork/vault-approvals.test.ts
```

Cases cover pending-without-access, atomic timed grant creation, evaluator destination enforcement,
expiry at the server boundary, explicit expired revocation, deny/cancel without grants, stale
policy/request/item conflicts, racing approvers, permission withdrawal immediately before commit,
failed writes, lost committed replies, idempotent retry and actor substitution, notification
failure, rereading through a rebuilt service, protected temporary-grant lifetime and credential
rotation after approval. A controlled TestClock replaces real-time waiting. The MCP request binds
the authenticated thread despite injected identity fields; no approval decision tool is exposed.
Grant APIs continue to reject agent self-approval and read-only clients. Existing grant, readiness
and explanation acceptance remains green.

## Client acceptance and remaining limits

Authorized isolated Browser-panel checks use the existing loopback synthetic OpenBao/server.
They cover empty/pending request display, five/fifteen-minute approval, denial, refresh and visible
revocation, expired approval visibility and the revoke path after expiry. The 390 CSS-pixel
layout has no horizontal overflow. Expiry uses synthetic fixture timestamps; no credential or provider is contacted.
Native iOS acceptance is **pending**: `mobile-native-client.ts check` reports the installed client
stale, and opening it shows an existing Threads-screen "Maximum update depth exceeded" overlay
before Vault is reached. The current no-install constraint excludes rebuilding/installing it.
Native typecheck/static checks pass; these are not native interaction acceptance. Android,
Electron shell, remote/relay/tunnel, keyboard/screen-reader and live-provider acceptance remain
open. No automatic resumption, notification delivery or allow-once consumption is claimed.

## Full packet acceptance still required

Verify requester status/cancellation and operation correlation without cross-thread disclosure,
then prove durable resumption/one-time consumption before exposing those flows. Exercise
notification failure/retry with an actual approved adapter. Add retention controls before claiming
unbounded queue operation. Verify approved devices over relay/tunnel, stale-client capability
handling and disconnect/reconnect races. Fresh human authentication and approver account
eligibility remain design decisions.

L75 is parked at **waiting on host policy**: its next managed-route/capture-codec section starts
only once CW-1 selects a real write primitive and L79 policy is in place. All L75 host writes
remain refused. L77 restricted acceptance remains unchanged. This milestone adds no Library
change, OpenBao namespace or policy permission. It upgrades an existing access-policy value to
schema version 2 upon the first request, which intentionally blocks older writers.
