# L84 testing

Status: **First local collection/reservation milestone verified within the limits below.** Full
packet acceptance remains unfinished. Implementation base is current fork main `4070ef99a2`.

## Focused automated evidence

Six focused suites pass **42 tests**: 13 real-service lifecycle/failure cases, client action/expiry
logic, destination-scoped command permissions, profile cleanup isolation, exhaustive fork RPC
permission mapping and actual MCP startup registration. No new MCP tool is added. Behavior covers
competing CAS writers, actor-bound replay/lost replies, expiry into quarantine without read writes,
old/new lease IDs, another session's refusal, renewal bounded to one hour, expiry during async
authorization, blocked archive while reserved, quarantine/retire/restore, duplicate item references,
collection identity/move refusal, active account/version checks, missing/wrong-kind items, ledger
corruption, malformed input, permission withdrawal and aged/evicted receipt replay. Client tests
cover reverse actions, ownership, archived state and the exact expiry boundary.

The disposable OpenBao 2.7.1 proof passes both phases (one applicable integration test before and
one after restart). It uses only the documented existing environment-scoped service policy,
including profiles/*; no production policy is read. It proves a single reservation CAS winner,
denied sibling namespace, unchanged format-3 policy, core item-list independence and matching-owner
release into quarantine after a backend restart. Synthetic account plaintext is absent from the
stopped Raft files. The fixture captures/stops its own process and removes its temporary state.
This is restart/encryption evidence, not a production backup or provider reset exercise.

```sh
./node_modules/.bin/vp test run \
  apps/server/src/fork/vault/VaultTestAccounts.test.ts \
  packages/client-runtime/src/fork/vault-test-accounts.test.ts \
  packages/client-runtime/src/fork/vault-test-accounts.permissions.test.ts \
  apps/server/src/fork/vault/VaultProfiles.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts \
  apps/server/src/fork/mcp/registration.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 \
  apps/server/src/fork/vault/testkit/test_accounts_proof.py \
  --bao /path/to/verified/openbao-2.7.1/bao
```

Server, contracts, client-runtime and mobile package typechecks pass. Web typecheck passes with
fresh incremental build info using the package's tsc-rs compiler; the ordinary TypeScript compiler
also passes. Initial upstream dependency-link and stale build-info failures were resolved by
reusing already installed packages and a fresh local cache. No install, lockfile change or
compiler/source workaround is included. Mobile native static checks pass. Focused lint/format,
changed links, seam manifest and whitespace are checked before commit; no repo-wide check runs.

## Integrated web evidence

The authorized test-t3-app Browser-panel pass used a new isolated Loom home, private disposable
loopback OpenBao and a synthetic Account item. No production database, personal credential or
existing Vault QA server was used or stopped. The backend used a disposable broad fixture policy
for that empty UI environment, separate from the narrowly scoped real-service policy proof above.

Observed through UI and real RPC: empty state; collection create and rename; safe account picker;
reference creation into quarantine; explicit clean review; reserve with correct connection owner;
release into quarantine; retire/restore; reference role edit back into quarantine; collection
archive/restore; and visible conflict/refusal when archiving an actively reserved collection.
The 1280px and 390px layouts render the account actions and safe references; the narrow document
width matches its viewport with no horizontal overflow. Review/cancel and labels are present.
No console error was observed in the checked flow. Expiry/races, offline/backend corruption,
permission withdrawal and retry outcomes have focused service/client evidence, not a claimed
manual/browser pass for every failure.

Browser artifacts (local evidence only, not committed):

- Desktop: `browser-screenshot-localhost-mvgvlbtd-2bfd18ca.png` in Kyle's browser-artifacts folder.
- Narrow viewport: `browser-screenshot-localhost-mvgvpe0q-872ab27d.png` in the same folder.

The native mobile implementation shares the guarded commands and expiry/action logic but has
not had an iOS/Android interaction pass in this slice. Native testing remains with the designated
owner. Electron shell/IPC, remote/relay/tunnel, keyboard-only and screen-reader behavior, live
application accounts and multi-worker login remain unverified. Desktop uses the shared web UI;
the browser pass does not imply Electron-specific acceptance.

## Scope and remaining acceptance

No raw password, cookie, TOTP or login session is returned or copied into the registry. This is
reference-only pool management; quarantine/retirement prevent reservations but do not revoke
external sessions or block generic Vault account access. Provisioning, automatic reset, mail
and login delivery remain unavailable. No agent reservation/delivery endpoint is exposed yet.
Manual clean review is an operator attestation, never adapter-reset proof. Full-access process
isolation and exactly-once provider effects are not claimed.

Continue with authenticated requester-scoped account selection/reservation and separate delivery
checks, then a chosen disposable app adapter, real reset/provision failure/cancellation recovery,
mail ownership/cleanup and browser/native login verification. These remain the full selected
PRODUCT outcomes. Policy3/journal1 and L86's false execution/resumption/allow-once gates stay
unchanged. L75 stays parked behind CW-1/L79. No Library schema, production, SSH, install or release
action is included. This branch is prepared for the release owner's landing review.
