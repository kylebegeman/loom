# L102: Personal Vault custody and trusted unlock

Status: **Designing**. Agent-proposed scope supporting Kyle's priorities confirmed on
2026-10-21. Kyle authorized starting local personal-Vault implementation; these detailed choices
are not individual selections. The L101 first build is **In progress** elsewhere.

Give a person custody of a private Vault that an unattended Loom development server and its
full-access agents cannot unlock. Establish the owner, reviewed storage engine, trusted
clients, device admission, locking and recovery before claiming personal-secret protection.
See [Personal Loom Vault](../LOOM-PERSONAL-VAULT.md).

## Scope

- In: engine/format evaluation, documented key hierarchy, encrypted metadata, owner bootstrap,
  trusted unlock and user presence, explicit lock, device admission/revocation, inspectable
  operations, cancellation and a tested recovery bootstrap.
- In: evidence that same-user full-access agents cannot read keys or invoke a useful unlock.
  Separate OS principals/devices are the proposed default; UI profiles and Electron storage
  encryption do not establish this boundary.
- Out: changing development-Vault custody, live migration, server deployment, broad secret
  delivery and selecting a production cryptographic dependency without review.

## Surfaces

Confirmed first platform targets (Kyle, 2026-10-21): Mac and iPhone, requiring independently
trusted clients/sessions. The current Loom
renderer and development server are untrusted for custody. Safari/Chromium use requires an
independently trusted client integration. Android, Windows and Linux remain explicit targets
with no protection claim until their isolation and recovery evidence exists. General web
shows setup/status guidance only; an agent-hosted bundle cannot become a trusted unlock UI.
Local, LAN, tailnet, relay and tunnel connections never move owner keys onto the server.

## Extension points and seams

`ext-personal-vault` is **proposed**, not implemented. Consume a reviewed shared primitive
when present; missing custody primitives leave real personal unlock unavailable. Do not
couple this packet to another numbered packet's internals. Existing `ext-core`, settings,
palette and optional desktop/mobile slots can expose non-secret status. Desktop fork IPC is
currently absent. [SEAMS.md](./SEAMS.md) records candidate integration points, not added seams.

## Documents

- [PRODUCT.md](./PRODUCT.md): custody workflow and unresolved owner choices.
- [TECHNICAL.md](./TECHNICAL.md): trust boundary and engine decision evidence.
- [SEAMS.md](./SEAMS.md): proposed registration and native-build seams.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered local work and release evidence.
- [TESTING.md](./TESTING.md): isolation, lifecycle and recovery proof.
- [REFERENCES.md](./REFERENCES.md): verified source and official references.
