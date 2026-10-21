# L106: Approve an outcome or lend a session

Status: Designing. Proposed scope supporting Kyle's priorities confirmed on 2026-10-21, not an individually selected packet. [L101](../L101-personal-vault-passwords/)'s first build is In progress elsewhere.

Let Kyle approve a particular account operation from a trusted personal client, or deliberately lend a temporary session whose actual powers are visible. The development host receives bounded operation results and opaque references, never personal master keys or password values.

## Scope

- In: account/site/task/duration review, adapter operation limits, current-authority checks, inspect/cancel/expire/revoke, cleanup receipts and uncertain-outcome recovery.
- In: common service/MCP access for every provider and scheduled agent run, with explicit unsupported adapter states.
- Out of the first usable slice: general website session lending without proven isolation or enforceable limits. Retain this ambition; do not label arbitrary browser control read-only.

## Surfaces

Kyle confirmed Mac and iPhone, Safari and Chromium as the first platform targets on 2026-10-21. Proposed acceptance uses an independently trusted Mac or iPhone to approve an operation requested by a local or remote agent; Safari and Chromium are evaluated separately. Android, Windows, Linux and standalone web require their own custody/control proofs and stay visibly unsupported until tested. A development-host web page is not a trusted approval surface by virtue of login.

## Extension points used

Existing fork core/MCP/settings/palette registrations are usable for metadata. The personal custody/operation boundary described in [Personal Vault](../LOOM-PERSONAL-VAULT.md) is **proposed**, not a shipped API. Without a verified primitive, show unavailable; never substitute server `VaultCore.reveal`.

## Packet seams

No code seams added. Native approval and browser isolation need an implementation-time inventory in [SEAMS.md](./SEAMS.md).

## Documents

[PRODUCT](./PRODUCT.md), [TECHNICAL](./TECHNICAL.md), [SEAMS](./SEAMS.md), [IMPLEMENTATION](./IMPLEMENTATION.md), [TESTING](./TESTING.md), [REFERENCES](./REFERENCES.md).
