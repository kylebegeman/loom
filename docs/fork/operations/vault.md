# OpenBao connection for Loom Vault

This guide configures the implemented record and online policy foundation. It does not deploy OpenBao, rewrite Git remotes or migrate personal credentials. Platform accounts, production
unseal/recovery custody, general workload launch attachment and unattended boot remain unfinished. Use synthetic credentials
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
`<mount>/data/environments/<namespace>/access-policy`, read/create/update on
`<mount>/data/environments/<namespace>/brokers`, and list on
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
There is no offline decrypted cache, forwarding agent, general workload lease or platform-account
administration. The signed mediated SSH operation is described below.

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

## Broker identity and presence

See the [enrollment flow](../user/vault.md#enroll-an-execution-host). The runner defaults to
`~/.config/loom/vault-broker`, with mode 0700 on the directory and 0600 on its PKCS8 identity
and pinned connection files. Store it outside project/worktree directories. The local machine
key is plaintext in owner-only storage. It is separate from the encrypted central registry,
and cannot isolate an agent with the same OS-user filesystem privileges. Do not clone it,
copy it into a project, share it with another host or import a personal SSH key for enrollment.

Only the owning Loom server needs OpenBao access. The execution host uses its private identity
and signed proof HTTP, with no administrator bearer token or OpenBao service token. The Loom
origin must use HTTPS except loopback HTTP for isolated tests. Direct reachable origins are
supported; a relay that requires a human session is not a supported headless runner route yet.

This milestone supports foreground macOS/Linux processes, online-only checks and renewal every
minute. Registration presence lasts two minutes. These are not credential-use leases. Starting
before login, reboot/logout recovery, Windows custody, automatic workload launch binding and runner-side SSH agents
remain pending. Signed workload and mediated SSH operations are described below. A sealed/unavailable backend denies checks; no decrypted offline cache or
personal-agent fallback exists. After a control-plane restart, request a new heartbeat challenge.

The encrypted registry retains 128 safe activity events and 32 mutation receipts. Disable is
permanent for that identity, survives normal restart and prevents new renewal. New identity
approval is required to restore a host. Restoring older backend data can restore older machine
approval state; reconcile disables before resuming traffic after any rollback. The complete
recovery/revocation process remains L87 work. This activity history is not an immutable ledger.

## Workload channel checks

`vault-workload-checks` adds process-local, five-minute sessions for active full-access/default
Loom runs. Sessions require distinct machine/workload proofs, a current host heartbeat, and a
current item/destination use grant. Signed checks use the existing encrypted policy/audit path;
no additional OpenBao policy path or backend token is needed. No credential payload is delivered.

A control-plane restart deliberately invalidates all sessions and challenges. Open a new
session from the current authenticated thread after reconnecting. Durable grants and enrolled
host approvals remain in OpenBao. Session list/close are caller-owned MCP operations; machine
disable or grant revocation prevents new allowed checks. Existing keys remain operator-owned.
General delivery adapters, automatic launch attestation, process isolation and production recovery
remain separate unfinished boundaries. Do not treat a successful check as cached use authority.

## Mediated SSH execution

`vault-ssh-mediated` uses existing encrypted item paths and the existing policy/broker paths;
no additional OpenBao privileges, mount or application dependency is introduced. Administrator
MCP/CLI generation creates PKCS8 Ed25519 key envelopes in OpenBao. The user-facing SSH tools
return public metadata. Existing explicit administrator reveal/export rights and backend/service
access remain powerful; this is not an OS isolation mechanism.

A destination pin is independently managed and may be empty. Only exact hostname/IPv4,
username and port targets with verified Ed25519 host keys are accepted. The server needs
`/usr/bin/ssh` with OpenSSH host-bound authentication and a reachable destination. It ignores
personal SSH configuration, agent sockets, known-host stores, proxies and multiplexed sessions.
The operation-scoped agent verifies the pinned host's exchange signature and accepts only the
assigned identity's host-bound authentication message. No generic signing or forwarding is
exposed. Windows and runner-side agent sockets remain unfinished.

Signed workload requests bind command argv, current item version and timeout. Policy/backend,
run/mode, machine heartbeat and item version are rechecked before execution/signing. Item
archive/delete, pin removal, a version change, workload closure or grant revocation blocks new
use when checked. An existing authenticated connection or issued signature cannot be recalled.
The command times out within eight seconds; local cancellation does not guarantee remote
rollback. Consumed proofs cannot be replayed. A lost response has an unknown outcome; do not
blindly retry commands with external effects.

The server bounds concurrency at four, agent sockets at four per operation, queued agent
frames at eight, frames at 16 KiB and stdout at 2 KiB. It drains SSH stderr without exposing it.
Scoped cleanup waits for its SSH child to close, then removes its socket and public temporary
files. An abrupt server kill may leave public temporary directories; private key files are not
created. Policy audit records access decisions, not successful remote-command receipts. Durable
operation reconciliation, production isolation/recovery and comprehensive audit remain pending.

Reproduce the synthetic macOS SSH/OpenBao proof without touching an existing SSH service:

```sh
python3 apps/server/src/fork/vault/testkit/ssh_proof.py --bao /absolute/path/to/bao
```

The fixture uses loopback, generated keys and a temporary authorized-keys file. It registers no
production credential, changes no user SSH setting and stops only processes it started.
