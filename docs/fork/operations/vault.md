# OpenBao connection for Loom Vault

This guide configures the implemented record and online policy foundation. It does not deploy OpenBao, enroll
machines, rewrite Git remotes or migrate personal credentials. Platform accounts, production
unseal/recovery custody and broker identities remain unfinished. Use synthetic credentials
until those controls and the full audit path are complete.

## Configure an existing isolated service

The tested engine is **OpenBao 2.7.1**, MPL 2.0, with integrated Raft and a KV v2 mount named
`loom`. This release does not support the old file storage backend or `disable_mlock` option.
Use its official operating guidance rather than adapting old Vault configuration examples.

Configure these variables on the Loom server, including an Electron-bundled server if it owns
the selected environment:

| Variable                        | Meaning                                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `LOOM_VAULT_OPENBAO_URL`        | HTTPS origin with no path, credentials, query or fragment. Loopback HTTP is accepted for isolated tests.                                  |
| `LOOM_VAULT_OPENBAO_TOKEN_FILE` | Path to a regular file containing the operator-provisioned service token. POSIX group/other access must be disabled, typically mode 0600. |
| `LOOM_VAULT_OPENBAO_MOUNT`      | KV v2 mount path, default `loom`.                                                                                                         |

Do not put the token itself in an environment variable, command argument, repository file or
chat. On Windows, provision an owner-restricted ACL; the adapter cannot validate POSIX mode
bits there. It re-reads the file on every request, so operators can atomically replace it when
rotating a token. Configuration changes require restarting the owning Loom environment.

The minimal engine policy needs read on `<mount>/config`, read/create/update on
`<mount>/data/environments/<namespace>/items/*`, read/create/update on
`<mount>/data/environments/<namespace>/access-policy`, and list on
`<mount>/metadata/environments/<namespace>/items`. The namespace is the lowercase hexadecimal
SHA-256 of the persisted Loom server environment ID, not a client-chosen project ID. Keep
policies scoped to that environment; creating another environment ID deliberately creates a
separate inventory. The operator creates the mount and service credential; Loom never creates
or stores a root token. Root tokens are used only inside the disposable test fixture.

Status checks health and KV v2 configuration, not all path privileges. A ready connection can
still receive a denied item operation if its policy is incomplete. A sealed backend reports
locked. Loom neither auto-unseals it nor asks an SSH key manager to unlock it.

## Trust and retention

OpenBao encrypts records at rest. Loom's service process can decrypt authorized records through
the backend, and explicitly revealed values travel over the existing authenticated Loom
transport. HTTPS is required for a non-loopback OpenBao connection. Configure remote Loom
transport securely using its existing deployment conventions.

The current service token file and upstream private secret input store are owner-only files,
not themselves encrypted Vault storage. A same-user full-access agent can access host files;
per-item policy cannot promise isolation from such a process without an OS boundary. Keep
personal credentials separate and provision narrow development credentials.

Delete writes an empty current payload/tombstone. Previous KV versions remain under OpenBao
retention; provider revocation, historical version destruction and backup deletion are separate
operations. Item mutation receipts support immediate retries. The access-policy record retains 32 grant
receipts and 256 safe policy/decision events; omitted-event counts are visible. This is not a
complete or immutable audit ledger. Policy audit must persist before a gated action is allowed.
A service token without policy-path access receives a denial, with no privilege fallback.
There is no offline decrypted cache, forwarding agent, workload lease or platform-account
administration in this milestone.

## Reproduce the disposable backend proof

Obtain the official OpenBao 2.7.1 binary and verify its published checksum. With repository
dependencies installed, run:

```sh
python3 apps/server/src/fork/vault/testkit/openbao_proof.py --bao /absolute/path/to/bao
```

The fixture owns temporary loopback Raft processes, keys, token files and storage. It tests KV
CAS, reads and versions, stops the process, checks that the synthetic canary is absent from
persisted bytes, copies the consistent stopped data, and proves decryption after clean restore.
It stops only its captured processes and removes the fixture in a finally block. It never
connects to an existing service or changes the live Loom home.

The stopped-copy test is a baseline recovery proof, not a production backup system. Production
requires a separately protected Raft snapshot/recovery-key process, restore drills, retention
and revocation reconciliation through Helios and L87. The fixture's single-share initialization
is exclusively for disposable data.

Official references: [OpenBao docs](https://openbao.org/docs/),
[KV v2](https://openbao.org/docs/secrets/kv/kv-v2/),
[Raft storage](https://openbao.org/docs/configuration/storage/raft/).
