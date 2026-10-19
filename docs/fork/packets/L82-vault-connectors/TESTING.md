# L82 testing

Status: **Local milestone verified; full packet acceptance remains open.** Synthetic fixtures only.

## Automated evidence

The focused integrated set passes **46 tests in 11 files**, covering profile retention/MCP,
GitHub service/transport/CLI, RPC authorization, client permissions/draft validation and web
settings registration. GitHub coverage verifies encrypted-core metadata boundaries, exact
repository grants, CAS/retry/lifecycle, changed run/account denial before delivery, authenticated
provider binding, human-only management, unrelated connection-format protection and scoped
provider-session release. No secret value is exposed by these metadata/error assertions.

The API adapter uses a disposable PKCS#1 RSA key to prove bounded JWT claims, repository-limited
installation requests, safe HTTP failures, token release and no dedicated-token revocation.
The fake gh executable proves isolated HOME/config, no ambient personal token/SSH socket,
output scrubbing/bounds, missing-CLI errors and temporary-directory cleanup. These are real
adapter-boundary tests with synthetic provider responses, not live GitHub acceptance.

```sh
node_modules/.bin/vp test run apps/server/src/fork/vault/GitHubTransport.test.ts apps/server/src/fork/vault/GitHubCli.test.ts apps/server/src/fork/vault/VaultGitHub.test.ts apps/server/src/fork/vault/VaultProfiles.test.ts apps/server/src/fork/vault/profile-mcp.test.ts apps/server/src/fork/rpcAuthorization.test.ts packages/client-runtime/src/fork/vault-github-draft.test.ts packages/client-runtime/src/fork/vault-github.permissions.test.ts packages/client-runtime/src/fork/vault-profiles.permissions.test.ts packages/client-runtime/src/fork/vault-profiles.test.ts apps/web/src/fork/settings/registry.test.ts
```

Scoped server, contracts, client-runtime, provider-core, web, mobile and desktop typechecks pass.
Changed-source lint and mobile native static checks pass. No repo-wide suite was run.

## Integrated client evidence and limits

Web/desktop bundle and native iOS used the existing isolated worktree state and disposable
OpenBao. Web verified App form setup, safe invalid-RSA rejection through the actual server,
authentication switching that clears private input, cancellation, synthetic connection metadata,
local disconnect/restore and 390px responsive management. Native verified App/token form
switching, empty-input validation inside the sheet, cancellation and the same synthetic
connection's local disconnect/restore. Long web action labels were shortened while preserving
full contextual accessible names; responsive layouts were visually rechecked.

The synthetic connection was seeded directly into disposable OpenBao for lifecycle/UI checks.
Its data is not an accepted GitHub credential. Successful provider authentication and GH
operations were exercised through service/adapter tests, not a live provider account or a
successful client onboarding call. No real token, App registration, provider write, PR or
personal credential was used. Electron shell, Android, relay/tunnel and live model execution
were not independently exercised. Ordinary terminal gh/Git HTTPS, project binding, OAuth/device
flows, Enterprise and provider revocation management remain selected, unimplemented work.

## Merge safety

After fetching upstream tags, parent `78c8d44b17` has **60 conflicting files** against
`v0.1.1-nightly.20261019.3348`. The committed section preview has the identical 60-file conflict set and no new conflicting
files. This milestone changes no upstream-owned files. A baseline upstream-sync issue
must be resolved in its own landing workflow; this is not a clean merge claim. No working-tree
merge, push, PR or deployment was attempted.

## GitHub profile binding milestone

The focused integrated set passes **35 tests in 9 files**: GitHub profile service/MCP/preflight,
GitHub connection service, existing profile MCP/launch/prompt services, portable contracts and
client permission/refresh regressions. New cases exercise local previews without provider calls,
missing/wrong-kind/invalid-repository bindings, exact use grants, pinned versions across service
reconstruction and profile edits, named GH without an SSH broker, mismatched operation kind,
archive/version/run/grant changes during token acquisition, scoped cleanup, launch denial/repair,
authenticated MCP execution and create-only portable GitHub import followed by local repair.

```sh
node_modules/.bin/vp test run apps/server/src/fork/vault/VaultGitHubProfiles.test.ts apps/server/src/fork/vault/VaultGitHub.test.ts apps/server/src/fork/vault/profile-mcp.test.ts apps/server/src/fork/vault/VaultPromptContext.test.ts apps/server/src/fork/vault/VaultLaunch.test.ts apps/server/src/fork/vault/VaultProfiles.test.ts packages/contracts/src/fork/vault-profiles.test.ts packages/client-runtime/src/fork/vault-profiles.test.ts packages/client-runtime/src/fork/vault-profiles.permissions.test.ts
```

Scoped contracts, client-runtime, provider-core, server, web, mobile and desktop typechecks,
changed-source lint and mobile native static checks pass. The native fingerprint is compatible;
no rebuild was needed. No repo-wide suite was run. The service test fixture now composes the
GitHub external adapters explicitly; unrelated synthetic connection tests keep their own adapters.

Web verified selecting a synthetic dedicated connection/repository, configuration-only review,
save/reopen, version 2 export without local bindings, fresh unbound import, local repair and
thread-specific denial without grants. Desktop-width and 390px layouts were inspected; picker
action labels were shortened with contextual accessible names. Native verified the shared
GitHub profile, dedicated connection/repository picker and configuration review. A
concurrent web import correctly rejected the stale native registry update; the editor was
refreshed before retry. Native then saved and reopened the persisted GitHub connection/repository. After a cold
launch, unbind/rebind, thread selection, denied-grant review and another save/reopen passed.
The editor uses the existing full-screen modal pattern with fixed review/save controls:
its former nested sheet measured beyond the visible detent and clipped those controls.
Connection and thread selection now use pages in the same modal, avoiding
native-sheet touch delivery across modal roots.

The GitHub record was seeded directly into disposable OpenBao and is not a working provider
credential. Client QA proves management wiring, not successful live provider authentication.
No live GitHub write, provider model, production state, deployment or personal-vault change was
used. Successful named execution and launch boundaries use real services with synthetic API/CLI
adapters. Live API/CLI health, terminal gh/Git HTTPS, Android, standalone Electron and relay/tunnel
transports are not independently verified here. Other selected packet scope remains open.

After fetching tags, parent `c1a61e657a` has **61 baseline conflicts** against
`v0.1.1-nightly.20261019.3360`. This section changes no upstream-owned source or seam manifest;
the committed preview has the same 61-file conflict set, with no added conflicting files.
No working-tree merge,
push, PR or deployment is authorized by these checks.
