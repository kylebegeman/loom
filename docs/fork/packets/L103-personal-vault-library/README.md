# L103: Personal Vault library

Status: **Designing**. Agent-proposed scope supporting Kyle's priorities confirmed on
2026-10-21, not an individually selected packet. Local personal-Vault work is authorized; L101's first build is **In progress**
elsewhere. See [Personal Loom Vault](../LOOM-PERSONAL-VAULT.md).

Make Loom useful as a personal library for logins, notes, recovery material, payment cards,
identities and files, with fast local search and deliberate reveal. Private titles, domains,
usernames and activity stay on independently trusted clients rather than becoming agent
reference metadata.

## Scope

- In: typed records and custom fields, attachments, search, favorites, version history,
  archive/restore, local reveal/copy, encrypted export and inspectable/cancellable operations.
- In: explicit lock, deletion/retention behavior, revoked-device and recovery states.
- Out: server-readable personal records, raw reveal/export tools, direct provider integrations
  and implementing a cryptographic generator or TOTP engine in this packet.

TOTP seed/issuer/account fields are retained as sensitive typed data. Display/use waits for a
reviewed native/shared crypto adapter and [proposed L107 platform delivery](../L107-personal-vault-native/); no
working TOTP API is asserted.

## Surfaces

Confirmed first platform targets (Kyle, 2026-10-21): Mac and iPhone, requiring trusted library
clients. Safari/Chromium library access
requires a trusted extension/client, not ordinary T3 preview. Android, Windows, Linux and
browser-only management remain explicit targets with honest unsupported states. Server-hosted
web/desktop UI can show non-secret availability and open the trusted client, never serve a
personal decrypted library. Remote connection mode does not change that boundary.

## Extension points and seams

`ext-personal-vault` is proposed. Consume shared typed encrypted-item, local custody and
portable-export primitives only when present; otherwise use fixtures or show unavailable.
No dependency on another packet's UI or private implementation is implied. Existing settings
and palette registries may expose non-secret launch/status entries. [SEAMS.md](./SEAMS.md)
identifies candidate native surfaces; no seams or API are implemented here.

## Documents

- [PRODUCT.md](./PRODUCT.md): personal tasks, entry points and states.
- [TECHNICAL.md](./TECHNICAL.md): typed data and local lifecycle.
- [SEAMS.md](./SEAMS.md): integration boundaries.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): build sequence.
- [TESTING.md](./TESTING.md): behavior and privacy evidence.
- [REFERENCES.md](./REFERENCES.md): source anchors and official references.
