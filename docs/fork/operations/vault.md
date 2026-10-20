# OpenBao connection for Loom Vault

This guide configures the implemented record and online policy foundation. It does not deploy OpenBao, rewrite Git remotes or migrate personal credentials. Platform accounts, production
unseal/recovery custody, broader delivery modes and pre-login macOS startup remain unfinished. Use synthetic credentials
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
`<mount>/data/environments/<namespace>/brokers`, read/create/update on
`<mount>/data/environments/<namespace>/profiles/*`, and list on
`<mount>/metadata/environments/<namespace>/items`. The namespace is the lowercase hexadecimal
SHA-256 of the persisted Loom server environment ID, not a client-chosen project ID. Keep
policies scoped to that environment; creating another environment ID deliberately creates a
separate inventory. The operator creates the mount and service credential; Loom never creates
or stores a root token. Root tokens are used only inside the disposable test fixture.

Status checks health and KV v2 configuration, not all path privileges. A ready connection can
still receive a denied item operation if its policy is incomplete. A sealed backend reports
locked. Loom neither auto-unseals it nor asks an SSH key manager to unlock it.

## Payload compatibility

New writes use a versioned serialized JSON envelope inside KV v2. This avoids OpenBao's JSON
string-count limit for bounded policy/audit registries; paths, CAS and retention are unchanged.
Existing records remain readable and are encoded on their next normal write. No live backend
is converted by the local milestone. Older Loom versions cannot read newly encoded records.
Use a compatible application reader for rollback, or restore a matching pre-upgrade snapshot
and reconcile revocations before resuming traffic. Keep backend and application recovery
versions together; do not lower backend JSON checks to work around audit growth.

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

The broker supports foreground operation and independent managed user services, online-only
checks and renewal every minute. Registration presence lasts two minutes and grants no workload
credential authority. Signed workload and mediated SSH operations are described below. A
sealed/unavailable backend denies checks and the running broker retries; there is no decrypted
offline cache or personal-agent fallback. Control-plane restart discards challenges and runners
request fresh ones. Real boot/logout acceptance, Windows custody and runner-side SSH agent
routing remain pending.

### Manage background brokers

Run `loom vault broker service plan --executable /absolute/path/to/loom` on the execution host,
then `service install` with that executable and `service start`. Each command accepts the same
`--state-dir` used during enrollment. Use an installed, stable absolute Loom launcher; passing
the Node binary alone does not launch Loom. For source-based development, an executable wrapper
must invoke both Node and the CLI entrypoint by absolute paths and forward its arguments.
The service uses a stable directory outside projects and does not hydrate an interactive shell.
Keep the launcher available across upgrades; a changed executable requires uninstall/reinstall.

The broker owns `~/Library/LaunchAgents/com.loom.vault-broker.plist` on macOS or
`~/.config/systemd/user/loom-vault-broker.service` on Linux. Installation enables startup but
leaves immediate execution explicit. macOS uses the logged-in GUI user domain. Linux/Pi uses
systemd's user manager; inspect `loginctl show-user <uid> --property=Linger --value` to establish
boot/logout continuity. The CLI reports linger rather than enabling it, and never invokes sudo.
Operators choose whether to enable lingering on the intended host. Pre-login macOS daemons and
system-wide/root services are outside this implemented mode.

`service status` is read-only: it never renews presence or creates an identity. It separates
installation, autostart, session continuity, process state and last signed observation. Unknown
manager/linger state remains unknown. Missing/unsafe local identity reports `localState: unavailable`;
stop/uninstall remain available without generating replacement keys. A report becomes stale after two minutes or heartbeat
expiry. `heartbeatCurrent` means recent machine presence from the managed process; use grants,
workload state and provider readiness still need their own checks. The report names owner-only
plaintext identity custody and control-plane backend unlock explicitly.

`service stop` stops now and leaves next-session startup enabled. `service restart` restarts the
existing enrollment. `service uninstall` stops/removes its definition and keeps private identity
and connection files. Failed stop preserves the definition. A changed or unsafe definition is
refused rather than overwritten. Re-running install with the identical plan can recover from a
partially failed manager operation.

The daemon writes one atomic mode-0600 `status.json` and safe JSON output; systemd retains output
in its journal. Outages, approval-pending and sealed backends retry every minute. Disabled or
invalid-proof identities stop after a terminal report, without regenerating keys or re-enrolling.
Managers restart unsuccessful process exits after 30 seconds; startup failures before a report
can be saved may therefore retry. Repair the underlying state and explicitly start/restart.
Abrupt death can leave the previous observation, which must expire before it can be trusted as
current again. No new access is allowed offline. General encrypted local custody, separate-user
workload isolation and production unseal/recovery ownership remain open.

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
Web/desktop/mobile and administrator MCP/CLI generation create PKCS8 Ed25519 key envelopes
in OpenBao. Client management is separately advertised as `vault-ssh-management`; older
servers without it hide those controls. The user-facing SSH tools
return public metadata. Existing explicit administrator reveal/export rights and backend/service
access remain powerful; this is not an OS isolation mechanism.

A destination pin is independently managed and may be empty. Only exact hostname/IPv4,
username and port targets with verified Ed25519 host keys are accepted. The server needs
`/usr/bin/ssh` with OpenSSH host-bound authentication and a reachable destination. It ignores
personal SSH configuration, agent sockets, known-host stores, proxies and multiplexed sessions.
The operation-scoped agent verifies the pinned host's exchange signature and accepts only the
assigned identity's host-bound authentication message. No generic signing or forwarding is
exposed. Windows and runner-side agent sockets remain unfinished.

The explicit administrator probe requires Vault write access and executes only `/usr/bin/true`
with the current pin/version, an eight-second limit and the same strict transport. It shares
the four-operation limit with workload commands. It rechecks authority/version through signing
and after completion, and returns safe evidence without remote output. It does not grant a
workload or make general readiness report SSH-ready. Agent MCP callers cannot invoke it.

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

## Enable hosted agent SSH and Git access

Enroll the machine running this Loom server using the existing broker procedure. Approve its
fingerprint in Vault brokers and keep `loom vault broker run` active on that machine. Set
`LOOM_VAULT_EXECUTION_BROKER_DIR` on the Loom server to that broker's absolute private state
directory, then restart the isolated environment. The directory must remain outside the
working tree with owner-only permissions. It holds the existing plaintext machine identity
and public connection metadata; it is not a new OpenBao token or encrypted machine-key store.
Use the same environment used for enrollment. Missing configuration or stale presence denies use.

Provider launches already attach an authenticated thread-bound MCP connection. Hosted
`loom_vault_ssh_exec` and `loom_vault_git` operations use it to acquire an in-memory workload
identity/session, sign a fresh operation proof with both identities and release the session on
completion, error or cancellation. The machine's service identity is never passed to a provider.
An active full-access/default thread and matching use grant are required. Fresh scheduled
agent threads can use project grants; command-only tasks and administrator MCP clients cannot
impersonate a thread through these tools. The CLI dispatches through the same connection.

Git ref listing/fetch runs in the thread's current server checkout with a canonical SSH URL,
verified host-bound key and a separate repository destination grant. Relative repository
`team/repo.git` uses `git+ssh://git@host.example:22/team/repo.git`; absolute `/srv/repo.git`
uses `git+ssh://git@host.example:22/:absolute/srv/repo.git`. The stored key's SSH destination
alone does not match this repository scope. Grants with no destination are deliberately broader.

The operation invokes `/usr/bin/git`, ignores global/system config, uses no credential helper
or personal agent, disables hooks and other transports, and does not fetch submodules or run
maintenance. Fetch writes objects and `FETCH_HEAD`, without merging or changing origin.
It is capped at 30 seconds and 64 KiB stdout; SSH remains 8 seconds/2 KiB. Both share the
four-operation limit. Process-group cleanup covers local Git/SSH children. A completed fetch
or other remote effect cannot be undone after cancellation, revocation or a lost response.
No automatic retry is performed. A nonzero Git exit code is returned in JSON; CLI process
status follows transport success, so consumers must inspect that field.

This provides on-demand access through the connection established at provider launch. It
does not install terminal agent sockets, configure ordinary shell Git, clone/push, GitHub
account credentials for ordinary terminals or reboot startup. There is no offline cache or process isolation from the same OS
user. No production registration or rollout is implied by the disposable proof.

## Project profiles and retained run selections

The `vault-profiles` capability stores each project's registry and run selections below
`environments/<environment-sha256>/profiles/<project-sha256>/`. Provision read/create/update
for that environment's profiles subtree in the service policy. Loom does not modify the live
policy or escalate the token. No SQL migration or new application dependency is needed.

Registry CAS revisions protect concurrent management edits. A run selection contains safe
labels, names, item references, versions and exact destinations, never credential values.
The first successful resolution creates it; service restart preserves it. Later defaults and
profile edits apply to later runs. Archive and policy/key/host checks remain live. These records
have administrator inspection and manual retirement for confirmed terminal runs. Retirement
writes a tombstone and prevents that run selecting again; OpenBao historical versions remain.
There is no automatic cleanup or physical erasure. Account for metadata growth in backups and
retain tombstones. Do not prune active-run selections or restore stale backups into a running
environment. Automatic retention and backup/recovery policy remain selected work.

## Dedicated GitHub connections

The `vault-github` capability needs the existing core item read/create/update rights in OpenBao.
There is no new SQL migration, backend mount or policy escalation. Install `gh` on the Loom
server for mediated execution on macOS/Linux; API setup/testing alone needs no CLI. The server
must reach `https://api.github.com`. No custom host, redirect or Enterprise endpoint is supported.

Use a dedicated App installation or fine-grained user token with API permissions matching the
intended operations and repository allowlist. The UI verifies API visibility, not permission for
every possible write. Private App keys stay encrypted through core records. Temporary App JWTs
and installation tokens are memory-only; use/test tokens are repository-limited. Scope cleanup
attempts token release. Failed cleanup logs a fixed warning and the token can remain valid until
expiry. Dedicated user tokens are never revoked by operation cleanup.

Execution creates private temporary HOME/config directories and explicitly supplies the current
token, with bounded concurrency/output/time. Personal GH configuration and SSH agent sockets
are excluded. Same-user/full-access processes are not OS-isolated. Local archive prevents new
use; remote provider revocation and OpenBao version history are separate operator decisions.
Existing host-setup precedence and persistent terminal logins are not changed. Explicit command-scoped routing is available through the Vault wrapper.
Project profiles now support explicit GitHub connection/repository bindings with pinned versions,
configuration/grant preflight and named mediated execution; GitHub-only operations need no SSH
broker. A live API/CLI probe remains separate from configuration preflight.
The vault-profile-github capability gates choices/imports on older servers. Version 2 portable
requirements carry no local connection/repository IDs; version 1 remains SSH/Git-only. Servers
with stored GitHub profile kinds cannot be downgraded safely without a reviewed restore plan. No real App registration, provider write, personal migration or production rollout is
part of the synthetic acceptance checks.

## Operate GitHub terminal routing

The `vault-github-terminal` capability advertises explicit gh/Git HTTPS commands and live
readiness. Install `gh` and `git` in the macOS/Linux Loom server's executable PATH. The child
gets a private HOME/config directory and selected credentials in its environment, with an
exact github.com repository credential helper for Git. Global/system Git configuration,
personal tokens, key managers and SSH sockets are excluded. Repository authentication,
HTTP, URL rewrite, include, filter and executable-transport settings are conservatively rejected;
review these settings explicitly rather than bypassing the check. TLS verification stays on,
redirects are disabled and repository hooks/automatic signing/maintenance are suppressed.

Commands infer cwd from the authenticated thread checkout or project root. `origin` is expanded
to the selected HTTPS URL for this invocation. Fetch without an explicit refspec also updates
`refs/remotes/origin/*`; persisted remote configuration is untouched. CLI output is raw scrubbed
stdout/stderr with the child's exit status. Combined output is capped at 64 KiB, command time
at 120 seconds, and connection-use concurrency at four. Cleanup removes the private directory,
terminates the owned process group and attempts App-token release. No local secret payload is
written into the helper, repository or prompt. Same-user/full-access processes can still read
credential-bearing children; this is scoped delivery, not OS isolation.

The wrapper requires the existing authenticated MCP endpoint/authorization environment. ACP
supplies that fallback; other provider harnesses may use the native MCP tool or explicitly
configure their terminal connection. Do not export administrator authorization to an agent to
work around a denial. Shared instructions advertise tools conditionally for every adapter,
including Pi. A server-context readiness result cannot certify that a harness propagates its
MCP environment to terminal children, a detached runner, a future grant or every provider write.
Persistent terminal activation and provider adapter environment setup remain separate work.
