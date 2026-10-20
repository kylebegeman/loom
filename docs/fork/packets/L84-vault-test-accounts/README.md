# L84: Test account collections and provisioning

Status: **In progress; local pool management and authenticated run leases implemented.** Kyle selected
full implementation on 2026-10-17 and approved this section on 2026-10-20. Provisioning, reset,
mail and login-delivery adapters and broader acceptance remain selected work.

Manage application test identities as reusable, isolated QA resources.

V12 | Major system | Complexity: Massive | Impact: Transformational

## Delivered local milestone

Settings > Loom > Vault test accounts now manages dedicated development/staging/test collections
and references to existing active Vault Account items. Web/desktop and native mobile code provide
create/rename/archive/restore, reference search/edit, exclusive session-owned reservations,
bounded renewal, release into quarantine, reviewed mark-clean and retire/restore. Expiry also
quarantines; it never silently returns an account to the pool. No password, cookie or TOTP seed
is copied into reservation metadata, and reserving grants no credential access.

This milestone manages the pool, not external login sessions. Quarantine and retirement block
new pool reservations but do not revoke credentials or log out an application. Clean review is
an explicit operator attestation, not a successful automated reset. Provisioning and login delivery
are unavailable. Authenticated agents can discover granted references and reserve/renew/release
only for their live run. Stopped/replaced or no-longer-authorized run leases are quarantined by
CAS cleanup; reservations still deliver no credentials. Internal login preparation now binds the
current lease and a separately granted canonical origin, with synthetic failure/cleanup proof
and every live-delivery gate closed. TESTING records the isolated web,
service/OpenBao proof and remaining native/remote acceptance limits.

## Scope

The complete selected outcome is described in [PRODUCT.md](./PRODUCT.md). Shared guarantees,
backend choices and design gates are in [Loom Vault](../LOOM-VAULT.md) and the
[proposed foundation](../LOOM-VAULT-FOUNDATION.md). This packet does not authorize deployment,
credential imports or changes to the personal vault.

## Surfaces

Web, desktop, mobile and remote management are required. CLI/MCP availability and any
OS-specific execution constraints are defined in the product and technical documents.

## Extension points used

Existing fork core, HTTP, settings, palette, CLI and MCP registrations as applicable.
`ext-vault` has an implemented encrypted-record boundary. Broker, identity and delivery portions
have partial implementations; inspect the exact services before consuming them.

## Dependencies and future opportunities

Uses account records, grants and delivery interfaces. Provisioning and mail adapters are optional capabilities; stored accounts remain usable without automatic creation. Unlocks disposable environments, seeded scenarios and parallel test workers.

## Packet seams

No upstream code seams are added. [SEAMS.md](./SEAMS.md) records fork-owned integration.
Implementation starts from current fork main `4070ef99a2`.

## Documents

- [PRODUCT.md](./PRODUCT.md)
- [TECHNICAL.md](./TECHNICAL.md)
- [SEAMS.md](./SEAMS.md)
- [IMPLEMENTATION.md](./IMPLEMENTATION.md)
- [TESTING.md](./TESTING.md)
- [REFERENCES.md](./REFERENCES.md)
