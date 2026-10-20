# L75 testing

Status: initial reviewed development secret/note imports verified locally. Full migration
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

## Full packet acceptance still required

Inventory must identify selected dependency metadata without reading personal store contents.
Typed adapters must verify replacement access before changing a selected repository, preserve
an unrelated personal repository, recover interrupted cutover and reject concurrent config edits
on apply/rollback. No such configuration-writing implementation is claimed in this slice.
L77 also remains restricted to its recorded local maintenance acceptance.
