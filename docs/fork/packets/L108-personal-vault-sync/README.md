# L108: Personal Vault offline cache and encrypted sync

Status: Designing.

Proposed scope supporting Kyle's priorities confirmed on 2026-10-21 in the [personal Vault umbrella](../LOOM-PERSONAL-VAULT.md). This packet has not been individually selected for implementation. Keep a personal Vault available on trusted devices without giving the development host its keys, and reconcile changes safely when devices reconnect. Sync/cache design is engine-dependent: whole-database/KDBX conflict-copy and engine merge behavior versus a maintained client-encrypted record engine.

## Scope

- In: encrypted device cache, offline unlock and edits, end-to-end encrypted sync, explicit conflicts, engine-native deleted-item/tombstone handling, supported key rotation and device pairing/revoke, and recovery entry points. Keep missing engine capabilities explicitly unsupported.
- In: honest offline revocation, clock, rollback and lost-device limits; inspect, pause/resume, cancel, close, lock and remove-device flows.
- Out: storing personal keys in today's server Vault, raw-secret agent access, live migration or deployment. [L109](../L109-personal-vault-recovery/) owns kits and clean-device recovery; [L88](../L88-vault-recovery/) owns development/server backup and restore.

## Surfaces

Mac plus iPhone, Safari and Chromium are Kyle's confirmed first platform targets as of 2026-10-21; native capability and custody acceptance still require inventory and proof. Personal custody must run in independently trusted clients; a host-served web view or existing Electron wrapper is insufficient. Android, Windows, Linux and standalone web remain tracked targets with explicit unsupported states, not assumed support. Remote relay traffic is ciphertext only; offline use cannot require the development server.

## Extension points used

Existing fork core/RPC, settings and palette registrations can carry safe status and launch controls. `ext-vault` provides server-readable development records, not personal custody. A personal custody/browser/native extension boundary is **PROPOSED, not implemented**. Missing custody support means unavailable; missing relay support means offline-only where an established trusted cache exists. See [SEAMS.md](./SEAMS.md).

## Overlap and ownership

[L102 custody](../L102-personal-vault-custody/) evaluates maintained engines/formats, with KDBX 4 first candidate, not selected. Use engine-native keys, integrity and sync; no custom crypto fallback. Unlinking a device cannot make it forget a complete database key. [L103](../L103-personal-vault-library/) owns item/history semantics, [L104](../L104-personal-vault-imports/) portable exports, [L105](../L105-personal-vault-browser/)/[L107](../L107-personal-vault-native/) trusted presentation and [L106](../L106-personal-vault-agents/) delegated sessions. These overlaps are not mandatory packet dependencies.

- [L79 server Vault core](../L79-vault-core/): encrypted storage/CAS patterns only, no personal root-key reuse.
- [L81 grants](../L81-vault-grants/) and [L85 delivery](../L85-vault-delivery/): service authorization and metadata/outcome exposure, never personal secret delivery.
- [L87 lifecycle](../L87-vault-lifecycle/): downstream credential rotation differs from sync encryption-key rotation.
- [L88 server recovery](../L88-vault-recovery/) and [L109 personal recovery](../L109-personal-vault-recovery/): coordinate selected-engine recovery and stale-state handling without importing packet internals or creating circular dependencies.

## Packet seams

None added. Native signing, entitlements, extension packaging and lifecycle seams require inventory before an implementation seam list can be approved.

## Documents

- [PRODUCT.md](./PRODUCT.md): behavior, states and open decisions.
- [TECHNICAL.md](./TECHNICAL.md): proposed protocol and trust limits.
- [SEAMS.md](./SEAMS.md): verified registrations and unknown native seams.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): proposed implementation sequence and open decisions.
- [TESTING.md](./TESTING.md): concrete acceptance cases and future commands.
- [REFERENCES.md](./REFERENCES.md): current source and official references.
