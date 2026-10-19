# L75 testing

Status: **Local milestone verified; full packet acceptance remains open.** Synthetic state only.

## Automated evidence

The focused integrated set passes **49 tests in 10 files**: profile service, reference service,
profile MCP, launch, SSH, RPC authorization, client-runtime permission/refresh and web registry
coverage. Profile cases include CAS/idempotency, project isolation, incomplete previews,
durable pins across reconstruction, later edits/default changes, live grant denial, key-version
conflicts and archive between resolution and signing. Named SSH/Git execution closes sessions.
Reference cases cover inspect filtering, forbidden/unknown null, rename/archive, canonical
reference search and sparse pagination. Shared mounted queries refresh after core/SSH changes;
profile writes fail after permission loss.

```sh
node_modules/.bin/vp test run apps/server/src/fork/vault/VaultProfiles.test.ts apps/server/src/fork/vault/VaultReferences.test.ts apps/server/src/fork/vault/profile-mcp.test.ts apps/server/src/fork/vault/VaultLaunch.test.ts apps/server/src/fork/vault/VaultSsh.test.ts apps/server/src/fork/rpcAuthorization.test.ts packages/client-runtime/src/fork/vault-profiles.test.ts packages/client-runtime/src/fork/vault-core.refresh.test.ts apps/web/src/fork/settings/registry.test.ts apps/web/src/fork/commandPalette/registry.test.ts
python3 apps/server/src/fork/vault/testkit/ssh_proof.py --bao /absolute/path/to/bao
```

The second command passes **3 real OpenBao/SSH/Git tests**, including named profile Git ref
listing, repeated fetch, trust/version/revocation checks and cleanup. It runs a disposable
server/repository and does not register a real account. Relevant contracts, server,
client-runtime, web, mobile, desktop and provider-core typechecks pass. Changed-source lint and mobile
native static checks pass. No repo-wide checks or production actions were run.

## Client evidence and limits

Web management verified at desktop and 390px width: create/review/save an incomplete profile,
edit and choose a referenced key, denied-thread preview, save, set default, archive/restore,
clone/cancel, reference search/copy and empty results. The narrow view has no horizontal
overflow. The authorized iOS pass verified reference copying, project selection, native
profile creation, nested key selection, host-only review and successful save. Metro required
a cache reset after serving an outdated module graph. The native client fingerprint matched;
no rebuild was needed. The isolated environment remains available for iteration.

Electron shell, Android, relay/tunnel paths, screen readers, live provider models and scheduler
launch are not independently verified by these checks. Services and shared web/native state
cover their common paths; this is not evidence of full platform acceptance. Composer/task
selection, other credential kinds, portable declarations and production recovery remain open.

## Merge safety

Implementation `9928a8072f` was previewed against `v0.1.1-nightly.20261018.3335` after fetching
upstream tags. The preview reports **56 conflicting files**. The pre-slice parent
`6e3301e02f` reports the identical 56-file conflict set; this slice adds no conflicting files
and touches no new upstream seams. The existing fork needs a separate upstream synchronization
before a clean landing rehearsal. This is a baseline integration limitation, not a clean-merge
claim. No worktree merge was attempted; Kyle's upstream-integration work owns its resolution.

The prior baseline nightly `v0.1.1-nightly.20261017.3238` merges cleanly in a read-only preview.
