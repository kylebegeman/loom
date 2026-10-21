# L109: Personal Vault recovery, backup and portability

Status: Designing.

Proposed scope pending Kyle's priority answers in the [personal Vault umbrella](../LOOM-PERSONAL-VAULT.md). This packet has not been individually selected for implementation. Recover personal data on a clean trusted device when the server or trusted devices are lost, without restoring obsolete access or sending recovery secrets through the development host.

## Scope

- In: an offline recovery kit, independently held encrypted backups/exports, verification exercises, clean-device restore without the original server, trusted-device loss, and explicit reconciliation of revocations and authority before resuming sync/use.
- In: inspect/cancel/close, kit replacement and retirement, export retention/removal, failed-restore cleanup and recovery after interruption.
- Out: live personal migration/deployment, development-server unseal/backup internals, and secret-bearing CLI/MCP exports. [L88](../L88-vault-recovery/) owns server recovery; neither packet requires the other to restore its own data.

## Surfaces

Mac plus iPhone, Safari and Chromium are provisional first acceptance, subject to Kyle's priorities and trusted native/extension inventory. Kit creation, recovery input and decryption belong to an independently trusted personal client. Browser integrations may launch it; a development-host-served page never receives the kit secret. Android, Windows, Linux and standalone web remain explicit tracked targets with unavailable states until supported custody exists.

## Extension points used

Existing fork core/RPC, settings, palette, CLI and MCP registrations can carry metadata/outcomes. The personal custody/native/browser boundary is **PROPOSED, not implemented**. Missing support means recovery unavailable on that surface, with instructions to use a supported independently trusted client. An existing offline archive remains usable without the Loom server when that client exists.

## Overlap and ownership

[L102 custody](../L102-personal-vault-custody/) evaluates maintained engines/formats, with KDBX 4 first candidate, not selected. Kits/exports/restore use the actual engine-native factors, format and recovery facilities. A stale complete database may contain old data/permissions; device removal cannot make a copied database key unreadable. No custom recovery cipher or authority frontier is assumed.

- [L108 sync](../L108-personal-vault-sync/): engine-dependent encrypted cache/sync, conflict copies and supported device controls; coordinate recovery behavior, not internal service dependencies.
- [L88 server recovery](../L88-vault-recovery/): infrastructure snapshots, host identity and development policy reconciliation. Restoring that server cannot unlock personal data.
- [L79 core](../L79-vault-core/) and [L81 grants](../L81-vault-grants/): existing server-readable records and policy patterns, not personal recovery authority.
- [L87 lifecycle](../L87-vault-lifecycle/): downstream credential rotation after loss; restoring encryption keys cannot revoke copied provider credentials.
- [L85 delivery](../L85-vault-delivery/): agents retain service gates and metadata/outcome limits; no personal recovery export through delivery adapters.
- [L103 library](../L103-personal-vault-library/), [L104 imports/exports](../L104-personal-vault-imports/), [L107 native](../L107-personal-vault-native/) and [L106 sessions](../L106-personal-vault-agents/): preserve supported content, report nonportable credentials and reauthorize delegated use. These are overlap boundaries, not mandatory dependencies.

## Packet seams

None added. Native file access, protected key storage, print/share/export, extension launch and independently signed recovery distribution require an exact future inventory. See [SEAMS.md](./SEAMS.md).

## Documents

- [PRODUCT.md](./PRODUCT.md): recovery choices, states and acceptance surfaces.
- [TECHNICAL.md](./TECHNICAL.md): custody, format and authority design.
- [SEAMS.md](./SEAMS.md): actual changes and unknown native integration.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): implementation sequence after prioritization.
- [TESTING.md](./TESTING.md): recovery scenarios and future commands.
- [REFERENCES.md](./REFERENCES.md): verified code and official sources.
