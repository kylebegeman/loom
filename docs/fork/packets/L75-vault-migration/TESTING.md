# L75 testing

Status: reviewed development imports, metadata inventory and replacement intent verified locally. Full migration
acceptance is incomplete; no personal credentials, production paths or provider probes used.

## Automated evidence

- `VaultMigration.test.ts`: explicit development attestation, prepare without item creation,
  immutable metadata/private-byte binding, idempotency, expiry using a controlled clock,
  cancellation, guarded archive conflicts after edits, and import/archive receipt recovery.
  Inspecting a recovered import does not write its ledger. Migration records/results omit the
  private value. Tests use real VaultCore with an in-memory CAS OpenBao boundary.
- `vault-migration.test.ts`: redacted ingress, required literal confirmations, unsupported
  typed kinds and private input length limits.
- `vault-migration.permissions.test.ts`: four mutations require the destination environment's
  write grant and observe revocation, independently of another environment's grant.
- `migration-mcp.test.ts`: list/status are the only tools; agents and read-only MCP clients are
  refused before service access.
- The real fork `mcp/registration.test.ts` verifies all toolkits can register during startup.

These five files passed **11 tests**. Existing feature, RPC authorization, settings and palette
registry checks passed **27 tests** in four additional files. All five changed package
typechecks, focused lint and the mobile native static check passed. Documentation links, the
390-row seam manifest and whitespace checks passed. Relevant packages: server, contracts, client-runtime,
web and mobile. Use only focused commands:

```sh
./node_modules/.bin/vp test run apps/server/src/fork/vault/VaultMigration.test.ts apps/server/src/fork/vault/migration-mcp.test.ts apps/server/src/fork/mcp/registration.test.ts packages/contracts/src/fork/vault-migration.test.ts packages/client-runtime/src/fork/vault-migration.permissions.test.ts
./node_modules/.bin/vp run --filter t3 typecheck
./node_modules/.bin/vp run --filter @t3tools/contracts typecheck
./node_modules/.bin/vp run --filter @t3tools/client-runtime typecheck
./node_modules/.bin/vp run --filter @t3tools/web typecheck
./node_modules/.bin/vp run --filter @t3tools/mobile typecheck
./node_modules/.bin/vp run lint:mobile
```

## Main integration

Merged current fork main `9b59eb558d` without conflicts; its Library backup changes are retained.
The ten-file focused integration run passed **56 tests**, including real fork MCP registration
and the merged backup suite. One existing live `sqlite3_rsync` test was skipped because
`LOOM_TEST_SQLITE3_RSYNC` is not configured; no binary was installed. All five consumer package
typechecks and focused lint passed again after the merge. No repository-wide checks ran.

## Integrated acceptance

Authorized local Browser-panel checks against isolated state passed:

- Blank and unconfirmed development forms cannot prepare; the separate review is required.
- Preparing creates only a migration ledger, confirmed by the synthetic OpenBao item 404.
- Cancel clears private input and creates no record. A prepared review can reopen and accept
  the same private value without losing the input field during typing.
- Confirmed secret and multiline note imports reach committed version one; status refresh
  preserves the result. Mismatched reentry reports a review-specific error and creates no item;
  corrected reentry can commit the same review. Guarded archive reaches version two, with restore in Vault management.
- Review hides private values, secret entry is masked, and a 390 CSS-pixel viewport has no
  horizontal document overflow.

The dev proxy briefly returned 502 during source-watch restarts; a reload after the backend
recovered restored the same isolated environment. This was not a migration operation failure.

Native mobile interaction is pending because the installed client is stale and installs are
currently prohibited. Electron shell, remote/relay/tunnel, version-skew interaction and real
OpenBao outage recovery remain unverified. Shared contracts and package checks do not replace
those acceptance passes. No browser result establishes native mobile acceptance.

## Metadata inventory and replacement-plan evidence

The ten-file focused inventory/adapter/contracts/permissions/registry/MCP run passed **45 tests**.
It includes the real fork MCP startup registration test. The adapter runs against a disposable
Git repository: included/global remote config is omitted, helper and SSH-command bodies are
not executed, ambient authentication variables are not inherited, and the config file stays
unchanged. Other cases cover bounded project pages, unavailable roots, omitted metadata,
URL userinfo/query/fragment sanitization, unsupported protocols, absolute/relative SSH paths,
`.git` preservation and ambiguous path rejection.

Replacement tests cover separate development/review attestations, matching typed adapter
metadata, immutable retries, source/root/item changes, expiry with a controlled clock, and
cancellation even when the source cannot be read. GitHub plans retain API/gh-only scope.
Contracts cannot represent a verified or cutover-authorizing result. Three destination write
commands observe revocation; administrator MCP reads refuse agent and read-only clients.

Authorized Browser-panel acceptance on isolated state passed inventory, development attestation,
separate review, GitHub scope display, source-change rejection, failed-read-safe refresh,
restored-source retry, review, cancellation, and an SSH plan showing missing host trust and the
exact absolute Git path. The 390 CSS-pixel layout has no horizontal document overflow. No SSH
probe, GitHub authentication, provider session, grant or repository cutover was performed.
Synthetic fixture Git metadata was changed only to exercise source conflict/recovery.
Native mobile interaction, Electron shell and remote/relay/tunnel acceptance remain pending;
mobile installation remains prohibited. Mobile code is covered by typecheck/static checks.

Run the six new focused files plus the existing four registry/authorization files:

```sh
./node_modules/.bin/vp test run apps/server/src/fork/vault/VaultMigrationInventory.test.ts apps/server/src/fork/vault/MigrationGitMetadata.test.ts apps/server/src/fork/vault/migration-inventory-mcp.test.ts packages/contracts/src/fork/vault-migration-inventory.test.ts packages/client-runtime/src/fork/vault-migration-inventory.permissions.test.ts apps/server/src/fork/mcp/registration.test.ts apps/server/src/fork/rpcAuthorization.test.ts apps/server/src/fork/features.test.ts apps/web/src/fork/settings/registry.test.ts apps/web/src/fork/commandPalette/registry.test.ts
```

## Inventory integration with current main

Merged fork main `173e1c95a1` without conflicts, preserving the Utilities focus fixes. The
inventory's ten-file run passed **45 tests** again, including real fork MCP registration. The
merged Utilities focus file passed **4 browser tests** from the web package with
`../../node_modules/.bin/vp test run src/fork/utilities/UtilitiesView.focus.browser.test.tsx --project browser`.
The root unit configuration rejects this browser file before running tests; use that package
browser project. All five changed package typechecks passed, and the web typecheck passed
again after the merge. Focused lint, native mobile static checks, documentation links, the
390-row seam manifest and whitespace checks passed. No repo-wide checks ran.

## Full packet acceptance still required

Live source-specific verification must bind the reviewed source, replacement item/version,
host trust and current permissions. Connection success alone is not repository access, and a
GitHub API result is not Git transport readiness. Typed imports and replacement provisioning,
verified cutover, interrupted-cutover recovery, unrelated personal-repository preservation and
concurrent-edit rejection during configuration apply/rollback remain unfinished. No configuration
writer is implemented in this slice. L77 retains its separate restricted local acceptance.
