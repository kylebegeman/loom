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

## Personal environment access

After backend and connection setup, an authenticated human administrator can open **Vault**,
confirm **This is my personal environment** and choose **Enable owner access**. Use **Use
restricted access** to disable it. This is a durable environment policy choice;
it is not inferred from localhost, a project path, a provider name, runtime full access or an
existing grant. Existing and shared environments remain restricted by default. Disable personal
access to return to the existing grant evaluator. Keep encrypted records, grants, backend
configuration and recovery material in place; do not rebootstrap OpenBao or reimport keys.

This declaration is the boundary for a personally controlled environment. Loom has no verified
platform multi-owner identity/membership model. It cannot safely distinguish an owner's agents
from another person's agents merely because both can launch work on the same server. Do not
enable this mode for shared tenants. The first declaration binds the authenticated human
subject; later changes require that same subject. Human policy administration stays separate
from agent MCP and provider-terminal access.

Personal access covers metadata inspection and supported brokered use for authenticated active
full-access/default agent runs. Item and connection scope, current versions, host pins, broker
requirements, active-run identity and runtime/plan permissions still apply. Item management,
trust administration, raw reveal/export and one-time protection retain their existing
restrictions. Credential availability never constitutes authorization for a deployment, write or
other task.

A resource name selects a connection; it is not an access token. Execution must pin the selected
item/version and revalidate its current policy and destination before credential use. Profiles
are optional reusable bindings, not an enrollment or access prerequisite. A lookup without a
visible match cannot prove that an inspect-hidden connection is absent. Keep missing selection,
policy denial, untrusted host, unavailable broker and upstream authentication failures distinct.

Disabling personal access affects new online decisions; independent restricted grants can still
allow use. Existing authenticated SSH sessions, GitHub tokens and completed remote effects are
not recalled. Provider revocation remains separate. A stale snapshot can restore an older access
mode as well as older grants. Reconcile both before reconnecting any restored environment.

## Owner policy compatibility

The first mode change stores a version-5 outer envelope on the existing environment
`access-policy` path. It preserves the complete legacy format-1/2/3 or protected format-4 policy,
owner binding and bounded change receipts. Grant, approval and audit writes retain those fields.
No new backend path, SQL migration or infrastructure setup is required. Existing environments
without an owner declaration continue to use restricted grants.

Older runtimes reject format 5. Disabling personal access retains the envelope and owner binding;
it does not make downgrade safe. Do not strip owner policy or protected classifications/intents,
reset the backend, or restore older access records to work around compatibility. Use a compatible
runtime and an isolated, reviewed recovery that reconciles later mode changes and revocations.
An enable retry returns current state; it must not re-enable a subsequently disabled environment.

`loom vault owner-policy` and `loom_vault_owner_policy` report the current mode. They are reads,
not setup commands. Agent or generic CLI/MCP clients cannot enable personal access. Named
selection uses `loom vault connections-resolve` / `loom_vault_connections_resolve`; direct tools
keep supporting explicit item ID/current version. A resolver `ready` report covers selection,
policy and saved host trust, not a broker probe or successful external login.

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

## Offline encrypted snapshot archives

On a POSIX operator computer, use `loom vault recovery` without connecting Loom to a backend.
Start with a consistent snapshot captured through the backend owner's approved procedure.
Keep it and any recovered plaintext on private encrypted storage. These commands accept files;
they do not capture or restore the backend, configure a schedule or add backend permissions.

```sh
umask 077
loom vault recovery key-create /private/key-custody/vault-recovery.key
loom vault recovery seal /private/staging/approved.snapshot /private/exports/vault.archive --key-file /private/key-custody/vault-recovery.key --environment-id YOUR_ENVIRONMENT_ID
loom vault recovery verify /private/exports/vault.archive --key-file /private/key-custody/vault-recovery.key --environment-id YOUR_ENVIRONMENT_ID
loom vault recovery unseal /private/exports/vault.archive /private/staging/recovered.snapshot --key-file /private/key-custody/vault-recovery.key --environment-id YOUR_ENVIRONMENT_ID
```

Create outputs in existing directories on local encrypted storage supporting hard links and
directory fsync (for example APFS or ext4), using new filenames. Direct output to exFAT/FAT,
SMB or FUSE is unsupported; exclusive publication refuses without a fallback when hard links
are unavailable. Copy the completed encrypted archive to offline media afterwards and verify
that copy before deleting the local archive. Keep plaintext and keys on private storage. Keys are random private binary files,
never passwords or command-line values. Keep the recovery key and backend unseal material
separate from exported archives and from the original host. Ownership, destination and retention
still need an operator decision; no off-host copy or deletion is automatic. Sources and keys
must be regular owner-only files. Existing files and symlinks are refused rather than replaced.
Windows is not supported by this local filesystem boundary yet.

Verification authenticates every encrypted byte and the expected environment without writing
plaintext. Unseal publishes a new private file only after authentication. Ctrl-C waits for the
in-flight operation to finish its staging cleanup before the CLI exits. Abrupt process or host
loss may leave private `.loom-vault-*.tmp` staging files; inspect interrupted work and the final
path before retrying. Filesystem errors can follow publication, so a failed command is not
permission to overwrite or assume the destination is absent. Retire plaintext snapshots and
staging files using the storage owner's approved procedure.

`authenticated: true` verifies the archive, not OpenBao consistency or authorization freshness.
Receipts always say `backendRestoreVerified: false` and `canPromote: false`. Restore only into
an isolated backend with compatible OpenBao/Loom readers, then reconcile post-snapshot revoked
machines, access mode, grants, sessions and upstream credentials before any workloads can
reconnect. An archive can correctly contain identities that were revoked later. Do not promote
an older snapshot when independent revocation evidence is unavailable. Production restoration
and trust promotion remain a host-owner action behind the L79 gates.

With installed dependencies and a verified OpenBao 2.7.1 binary, reproduce the isolated drill:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 apps/server/src/fork/vault/testkit/recovery_proof.py --bao /verified/path/to/bao
```

It owns temporary loopback backends and synthetic data only. It proves real snapshot decryption
and policy preservation, deliberately demonstrates a post-snapshot token returning, and revokes
it before cleanup. It never promotes a restored service or touches existing backend state.

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
and revocation reconciliation through Helios and L88. The fixture's single-share initialization
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
recovery/revocation process remains L88 work. This activity history is not an immutable ledger.

## Workload channel checks

`vault-workload-checks` adds process-local, five-minute sessions for active full-access/default
Loom runs. Sessions require distinct machine/workload proofs, a current host heartbeat, and a
current item/destination authorization under the selected access mode. Signed checks use the
existing encrypted policy/audit path; no additional OpenBao policy path or backend token is
needed. No credential payload is delivered.

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
An active full-access/default thread and current access-policy authorization are required.
Personal owner-trusted mode does not need recurring grants. In restricted mode, fresh scheduled
agent threads can use project grants; command-only tasks and administrator MCP clients cannot
impersonate a thread through these tools. The CLI dispatches through the same connection.

Git ref listing/fetch runs in the thread's current server checkout with a canonical SSH URL,
verified host-bound key and repository-scoped authorization. Restricted mode requires a
matching repository destination grant. Relative repository
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

## Native terminal connection operations

`vault-native-terminal` prepares Codex/Claude sessions with a private temporary descriptor.
It is plaintext with owner-only POSIX permissions; Windows needs owner-restricted inherited
ACLs. Rotation removes the old file, clear removes its current file, and service shutdown
removes the private directory. A crash can leave temporary files whose tokens the restarted
registry no longer accepts. Do not copy these files into shell profiles, service definitions,
backups or logs. Other agents running as the same OS user are not isolated from the files.

Run `loom vault terminal-readiness` in the actual agent terminal. A connection error calls for
restarting that provider session or using hosted tools; it is not a request to sign into a
personal password manager. An inactive run or offline enrolled broker is reported separately.
Selected-item/version/destination authorization and actual upstream readiness remain separate
checks.

## Production rollout procedure

This procedure is a handoff, not a completed deployment. Run it only in a separately authorized
production rollout. Never start an implementation/test process against `~/.t3/userdata`.
No Library deployment is required for the implemented environment-local Vault services.

1. Allocate the OpenBao service host and HTTPS origin under the existing begam.in/platform
   operating conventions. Supply the hostname and TLS certificate paths explicitly. Use a
   dedicated OS service identity and persistent Raft directory with mode 0700. Install the
   official OpenBao 2.7.1 binary after verifying its published checksum. Keep it pinned with
   the compatible Loom application version in the recovery inventory.
2. Configure `api_addr` to that HTTPS origin, `cluster_addr` to the private cluster address,
   a TLS-enabled TCP listener using the operator-supplied certificate and private key, and
   `storage "raft"` with a persistent directory and unique node ID. Do not use dev mode,
   `tls_disable`, the removed file backend, or credentials in the service environment.
   Install/start the service through the existing host service manager and restrict network
   access to the intended Loom authority. Keep the cluster port private.
3. Initialize through the operator's authenticated administrative channel:
   `bao operator init -key-shares=5 -key-threshold=3`. Deliver individual shares to the
   designated recovery custodians separately from Raft storage and backups. Do not save a
   root token or combined recovery bundle in the Loom repository, runtime home, chat or
   backup directory. Unseal with `bao operator unseal`, entering shares interactively.
   This procedure requires operator unseal after a cold restart; it does not establish
   automatic unseal. A separately approved external seal authority is required to change that.
4. With `BAO_ADDR` pointing to the chosen HTTPS origin and an administrator authenticated
   interactively, create the mount and require CAS:
   `bao secrets enable -path=loom kv-v2`, then `bao write loom/config cas_required=true`.
   Choose explicit KV version retention consistent with the recovery policy.
5. Obtain the persisted environment ID from the **owning** Loom environment's descriptor,
   and compute its lowercase hexadecimal SHA-256 namespace. Prepare an OpenBao policy with
   read on `loom/config`, read/create/update on that namespace's item, policy, broker and
   profile paths, and list on item/profile metadata as described above. Add selected health
   and migration paths from the operating-policy sections below. Review the exact
   paths against the current adapter. Do not grant root, wildcard-environment access,
   mount administration or Raft snapshot privileges to the Loom service credential.
6. Install that policy with `bao policy write <environment-policy> <reviewed-policy.hcl>`.
   Provision a renewable narrowly scoped service token using the existing secret delivery
   mechanism. Write it to an owner-only file outside projects, set
   `LOOM_VAULT_OPENBAO_URL`, `LOOM_VAULT_OPENBAO_TOKEN_FILE` and
   `LOOM_VAULT_OPENBAO_MOUNT=loom` on the owning Loom service, and restart only that service
   in the authorized rollout. Never put the token value in argv or environment variables.
7. From an authenticated administrator client, verify backend status, then create/read/archive/
   restore/delete a synthetic canary. Confirm another environment cannot list it. Enroll the
   execution computer through `loom vault broker` and the reviewed administrator flow; compare
   its fingerprint on both ends before approving. Follow the managed-broker procedure above,
   start its heartbeat, and set `LOOM_VAULT_EXECUTION_BROKER_DIR` on the owning Loom service
   to the reviewed private identity directory. Do not enroll or approve a machine on its behalf
   from an agent prompt.
8. Generate a **dedicated development** SSH key or register a dedicated GitHub App/token.
   Register only its public key upstream. Independently verify SSH host trust. Enable
   personal access or create restricted item/action/destination grants. A project profile is optional. From an actual Codex/Claude/Pi run,
   check terminal and selected-credential readiness, perform a synthetic read operation, then
   withdraw all applicable access and prove the next use fails. Test broker restart, sealed backend and network outage.
   Keep personal 1Password/SSH configuration separate; no implicit remote migration occurs.
9. Before entrusting real credentials, use an operator credential separate from Loom's token
   to run `bao operator raft snapshot save <protected-snapshot>`. Transfer the encrypted
   snapshot off-host with its checksum and compatible application/configuration version;
   keep recovery shares separately. Restore with `bao operator raft snapshot restore` into
   an isolated Raft service, unseal through its recovery procedure, and verify canary decryption,
   item lifecycle, policy and host records. Record the recovery owner, retention and actual
   recovery time/data loss. Never restore over an active authority as a verification step.
10. Promotion is explicit: stop old-authority traffic, reconcile all post-snapshot revocations
    and disable lost/stale machines before allowing new use, switch the selected authority,
    then re-enroll/revalidate hosts. A stale snapshot can restore an earlier allow grant;
    backup success alone cannot prove current revocation state. If revocation history is lost,
    keep workload access disabled and replace/revoke the affected downstream credentials.
    For rollback, use a compatible application reader or a matching pre-upgrade snapshot,
    then repeat revocation reconciliation. Report actual upstream revocation outcomes separately.

Until these operator checks and custody decisions are complete, the tracker remains
**waiting on deploy** and synthetic local acceptance must not be presented as production readiness.

## Health inbox operating policy

`vault-health` requires read/create/update on
`<mount>/data/environments/<namespace>/health`, in addition to the existing item permissions.
The host owner must add this exact path to the reviewed environment policy before enabling
health in a production environment. No Library service or schema change is needed. The
production policy was not changed by this branch.

Rules and issues are encrypted in the same environment namespace. Automatic checks are opt-in,
limited to the dedicated GitHub repository adapter and declared expiry. The worker checks at
most 25 due items each minute, two concurrently, with a 15-minute item interval. Explicit
rechecks enforce a burst limit. There are no emails, push messages, credential rotation or
provider revocations. Remove a rule to stop future probes; in-flight requests may finish, but
outdated results cannot overwrite a changed rule or newer item version.

SSH health validation is an explicit rule option. It uses the saved key's destination and pinned
host key with the existing eight-second fixed no-op probe; it never falls back to a personal
agent. Automatic validation remains separately opt-in. Deploying this code does not enable it
for existing rules. A timeout is an outage, and untrusted-host or other SSH failures require
configuration review. These results do not establish credential revocation. No additional
OpenBao paths or Library changes are needed beyond the health policy above.

## Development import operating policy

`vault-migration-imports` adds reviewed, manually entered development secret/note imports.
The host owner must add read/create/update on
`<mount>/data/environments/<namespace>/migrations/*` and list on
`<mount>/metadata/environments/<namespace>/migrations` to the existing environment policy.
Core item permissions remain required. A ready backend status does not prove these new rights.
Until that policy and the L79 production gates are satisfied, L75 is **waiting on deploy**.
No Library service, schema, mount, dependency or personal credential configuration changes.

These commands are a host-owner handoff. They were not run against production. Run with an
already authenticated operator CLI, not Loom's restricted service token. Set `LOOM_USERDATA_DIR`
to the owning server's existing userdata directory, `BAO_POLICY` to its reviewed policy name,
and `BAO_MOUNT` to its existing KV v2 mount (normally `loom`). Confirm the target OpenBao origin
with `bao status` first. No token belongs in shell arguments, chat or the policy file.

```sh
set -eu
: "${LOOM_USERDATA_DIR:?Set the owning server userdata directory}"
: "${BAO_POLICY:?Set the existing environment policy name}"
: "${BAO_MOUNT:?Set the existing KV v2 mount}"
bao status
umask 077
migration_policy_dir="$(mktemp -d)"
export migration_policy_dir
bao policy read "$BAO_POLICY" > "$migration_policy_dir/before.hcl"
python3 - <<'PY'
import hashlib, os, pathlib, re
userdata = pathlib.Path(os.environ['LOOM_USERDATA_DIR'])
environment_id = (userdata / 'environment-id').read_text().strip()
if not environment_id:
    raise SystemExit('Missing environment identity')
mount = os.environ['BAO_MOUNT']
if not re.fullmatch(r'[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*', mount):
    raise SystemExit('Invalid mount path')
namespace = hashlib.sha256(environment_id.encode()).hexdigest()
directory = pathlib.Path(os.environ['migration_policy_dir'])
base = (directory / 'before.hcl').read_text()
addition = f'''
path "{mount}/data/environments/{namespace}/migrations/*" {{
  capabilities = ["read", "create", "update"]
}}
path "{mount}/metadata/environments/{namespace}/migrations" {{
  capabilities = ["list"]
}}
'''
(directory / 'reviewed.hcl').write_text(base + addition)
PY
diff -u "$migration_policy_dir/before.hcl" "$migration_policy_dir/reviewed.hcl" || test "$?" -eq 1
```

Review that diff against the correct environment and preserve any existing stanzas. If the
migration paths already exist, edit those stanzas instead of leaving duplicate path rules.
Apply the resulting policy with:

```sh
bao policy write "$BAO_POLICY" "$migration_policy_dir/reviewed.hcl"
```

No Loom restart is required for a policy update on its existing token. The runtime must include
the L75 implementation and use the same environment ID. In that computer's settings, prepare a
synthetic development record, verify that preparation created no item, cancel it, then prepare,
explicitly import, refresh and archive another synthetic record. Confirm an agent thread cannot
use administrator migration tools and no repository settings changed. Keep actual provider
verification and repository cutover separate. Host owner records this evidence before using
real development credentials.

Policy rollback uses the retained original file; this disables new migration operations and
does not undo imports, revoke provider credentials or erase encrypted history:

```sh
bao policy write "$BAO_POLICY" "$migration_policy_dir/before.hcl"
```

Import ledgers retain metadata and value digests encrypted in OpenBao, never plaintext values.
There is no automatic ledger retention/erase job. Include these paths in existing backup and
retention procedures. Cancellation, archival and restore are logical actions, not KV history
erasure. If an imported record changed before a failed receipt was recovered, resolve the
conflict manually without overwriting that newer record.

## Replacement plan operating policy

Metadata-only inventory uses no OpenBao writes, authentication or network probes. Replacement
plans are separate from private import ledgers and need read/create/update on
`<mount>/data/environments/<namespace>/migration-replacements/*` plus list on
`<mount>/metadata/environments/<namespace>/migration-replacements`. Existing core item rights
are required to inspect candidate adapter metadata. L75 remains **waiting on deploy**, gated
on L79; the host owner is not being asked to run production commands now. No Library change.

When the host owner clears those gates, use the development-import procedure above with this
additional policy block. For the exact same command sequence, replace the two `migrations`
path segments in that procedure with `migration-replacements`. Preserve the original policy
backup, review the namespace-scoped diff, then use the same `bao policy write` and rollback
commands. These paths must be added separately; existing import permissions do not cover them.

```hcl
path "<mount>/data/environments/<namespace>/migration-replacements/*" {
  capabilities = ["read", "create", "update"]
}
path "<mount>/metadata/environments/<namespace>/migration-replacements" {
  capabilities = ["list"]
}
```

Inventory excludes global/included config, SSH configuration/aliases, environment overrides,
other checkout roots and external consumers. It cannot identify a personal credential owner or
prove unattended readiness. GitHub API/gh connection plans cannot verify Git transport. Reviewed
plans require separately confirmed verification and retain cutover-unavailable outcomes; they
grant no workload access and perform no configuration writes. Retain these encrypted ledgers in the
existing backup procedure; there is no automatic retention or history erasure.

## Replacement verification operating limits

Verification receipts use the already deferred replacement-plan data paths and add no OpenBao
permissions, Library changes or host installation. They are optional fields in existing ledgers;
no SQL or live data migration is required. Keep the host-owner handoff deferred behind L79.
The implementation does not enable a background check on startup or during inventory/inspection.

Only explicit human requests from a write-authorized connection contact a provider. SSH uses
an isolated working directory, dedicated key and pinned host for fixed `ls-remote`; it neither
fetches nor changes project configuration. GitHub creates a scoped API session from the selected
Vault connection and performs its existing cleanup. Provider responses and refs are not stored
in receipts. Those checks do not route ordinary terminal commands or remove existing personal
1Password approvals from unrelated operations.

Provider work has a thirty-second deadline; SSH itself has an eight-second limit. Evidence
lasts at most sixty seconds, bounded by plan and token expiry. Persistence and cleanup can add
latency. Inspecting a receipt never reruns a check. If the final write fails, a running receipt
becomes interrupted, never implicitly successful. Reconcile with a new explicitly confirmed
read attempt. The latest receipt and its predecessor pointer are retained in the current ledger;
older current-state retries conflict. KV history/backups follow the existing retention policy.

Live SSH/provider/remote/native acceptance and production rollout remain pending. No host
commands, installation, production action or live SSH verification were performed for this
slice. Positive automated checks used injected synthetic transports. Cutover stays blocked;
future configuration writers must revalidate fresh operation-specific evidence, source/item,
trust and current permissions immediately before writing. An API receipt cannot verify Git
transport, and a receipt cannot establish workload grants or current provider revocation state.

## Replacement route preview limits

Read-route and hypothetical rollback previews use only existing replacement/item metadata.
They require a fresh, matching SSH repository-read receipt and perform no provider probe or
backend write. They add no OpenBao path, policy permission, infrastructure or Library deployment.
Keep replacement subtree rollout with the host owner behind L79. GitHub API evidence cannot
establish Git transport eligibility; pushes remain unsupported. Both execution paths are
unavailable. Original-route authentication and a restorable configuration snapshot must be
verified/designed separately before any future writer. Do not treat a preview ID as an execution
authorization or rollback artifact.

## Typed development import compatibility

Typed SSH/GitHub reviews reuse the existing migration and item subtrees and add no OpenBao
policy permission or Library requirement. Keep the migration/replacement namespace rollout
with the host owner behind L79. Private material enters only the selected development Vault
through explicit human attestations; this is not automated proof that a credential is unused
by personal or production systems. Do not supply those credentials to this workflow.

Credential formats are checked locally and account names are declared expectations. No import
contacts a provider, grants access or changes transport configuration. All execution gates stay
false. Typed reviews use protocol two and separate APIs so older clients can use protocol-one
manual imports against an upgraded server. Older server versions cannot inspect protocol-two
reviews; retain a compatible runtime/history when planning rollback. No new production commands
are required for this slice beyond the already deferred L79-gated host rollout.

## Original-route evidence and recovery design limits

Original development-route checks select a separate existing Vault SSH item and persist only
safe evidence in the optional original receipt field of the existing replacement record. They
never use a personal agent or infer the historical shell identity. Explicit source user/host/
port/path, live item version and pinned host trust are required. The normal transient local
metadata read remains; neither it nor the design preview captures a restorable configuration.

Recovery snapshot storage, journal phases and conflict rules are proposed in the
[L75 technical design](../packets/L75-vault-migration/TECHNICAL.md#proposed-recoverable-snapshot-format-and-journal).
The current preview has no capture engine or host writer. An advisory lock is not proof against
external editors; that strategy and actual route integration remain unresolved. Keep cutover,
rollback and configurationWrites false. Existing migration/replacement rollout stays with the
host owner behind L79. This slice adds no OpenBao path, policy permission, Library deployment or
host command. Retain a runtime that understands the new optional evidence when preserving it;
older runtime rewrites may omit fields they do not recognize.

## Temporary approval policy compatibility

The first approval milestone introduced access-policy format 2. Requester lifecycle and
retention writes use format 3 whenever an approval ledger is present, unless the policy already
uses format 4. Current readers accept formats 1/2/3/4 directly or inside the format-5 owner
envelope; 0.0.97 and earlier cannot read format 3. Required credential classifications and
operation intents must survive every policy write. Personal access does not bypass format-4
one-time protection. Existing format-3 policies are not automatically migrated.

Older runtimes that accept only formats 1/2/3 reject format 4 and cannot operate that
environment's Vault. Never lower the version, strip classifications/intents or restore a legacy
policy to enable downgrade. Use a compatible reader or the host owner's reviewed stop/fence,
recovery and post-snapshot revocation reconciliation procedure. A nightly alone does not
migrate policy or enable one-time execution. Production migration, existing-session fencing
and independent rollback/deletion protection remain host-owner operations behind L79.
Downgrade requires a compatible reader or an explicitly reviewed pre-feature backup, including
reconciliation of revocations after that backup. Never silently strip correlation, the request
queue or restore old access by changing a version number.

The current queue has a fixed 24-hour age limit and 128-entry cap. The scoped server worker
sweeps on startup and each minute; creation also safely prunes aged entries. Status/inbox hide
aged entries immediately on a successful read. Cleanup removes aged entries and their expired
approval grants in one CAS and refuses inconsistent live bindings. Outages defer physical
cleanup until a successful sweep. It does not erase KV history, backups or the separate audit.
Existing policy write rights suffice; no new OpenBao paths, destroy permissions or Library
rollout are introduced. Migration/replacement rollout remains deferred to the host owner behind
L79. Notification delivery remains stubbed; automatic resumption and one-time consumption are
still disabled. Kyle owns native acceptance and the Threads-screen render defect.

## Gated operation-journal compatibility

L86's internal journal uses `environments/<namespace>/profiles/_operations/approval-journal-v1`
in the existing `loom` KV v2 mount. `_operations` is reserved and is not a project hash. The
existing documented `profiles/*` read/create/update rights cover this record; no list, delete,
destroy or additional policy capability is needed. The isolated policy proof is in L86 TESTING.md.
No production policy was inspected or modified. Service construction does not open the record;
no public operation or background dispatcher currently writes it.

The version-1 journal body is separate from the inner access-policy format and uses the same
json-v1 store envelope and CAS. It retains at most 128 entries for 24 hours from original
request creation; current-value pruning does not erase KV version history or snapshots. Older
runtimes can read legacy format-3 policies and ignore the reserved journal path, but reject the
owner-mode format-5 envelope. They cannot resume a journal-bound operation. Current MCP retry
preparation includes an optional read-only recovery observation; older preparation tools omit it
and do not inspect the journal. A downgrade must not be used to bypass durable outcome review.
Re-upgrade must reconcile journal state with current access, item and run state; never remove
journal evidence to make a request retryable. Restoring an old snapshot also needs revocation
and outcome reconciliation. A reserved entry with uncertain dispatch becomes unknown and is not
automatically repeated. Notification observations are still process memory. Execution,
resumption and allow-once gates remain closed; enabling them requires Kyle's approval.

## Test account registry compatibility

The first L84 milestone stores only account references, collection metadata and exclusive lease
state under `environments/<environment-sha256>/profiles/_test_accounts/registry-v1`, through the
existing json-v1 envelope and CAS adapter. Existing scoped profiles-subtree rights cover it; no
new mount or policy right is needed. Keep `_test_accounts/` and `_operations/` out of any future
profiles-root project enumeration. Project cleanup remains under its exact hashed project prefix.

Older runtimes ignore this independent version-1 registry and retain their normal Vault item
behavior. They cannot coordinate pool leases. Reservation/quarantine are pool-management state,
not a restriction on all generic credential use, revocation of external logins or a replacement
for item grants. Do not promote generic access to a protected worker-login claim. The inner
access-policy format and operation journal version 1 are unchanged; owner mode retains its
format-5 envelope.

Human leases bind to authenticated client session IDs, not pairing subject labels. Re-pairing cannot
renew/release a prior session's lease; an authorized manager must explicitly quarantine or retire
it. Expired entries are quarantined on reads and persisted on the next successful mutation.
Manual mark-clean is an operator attestation, not provider reset evidence. Capacity is 32
collections and 128 references, including archived/retired entries; receipts retain at most 128
and prune entries older than 24 hours on mutation. No production accounts are auto-discovered,
provisioned or migrated. Use only separately approved dedicated test identities.

Agent pool ownership is a `run-v1:` binding inside the same registry-1 owner string.
Authenticated MCP callers cannot choose it. Discovery and reserve/renew require current
inspect/use authority for `loom:test-accounts:<collectionId>` (matching grants in restricted
mode); this is a metadata pool scope and does not authorize provider login. Release requires the
exact owned lease even after grant withdrawal. The cleanup reactor runs at startup and every
minute, quarantining expired or invalid run leases via the existing ledger CAS.
Outages/corruption refuse and retry later; reads cannot grant login while waiting. A cleanup
conflict never clears a newer lease. Clean review remains a separate manager action.

Runtimes predating workload cleanup can still decode registry 1 and preserve run owner strings,
but cannot reconcile run termination or grant withdrawal. Keep pool workers on a runtime with
this support or explicitly quarantine affected leases before downgrading. The inner
access-policy and journal 1 remain unchanged; owner mode retains its format-5 envelope. No new
host policy, path, mount or Library rollout is needed for this slice. This is pool coordination
only; generic credential use and external sessions are not governed or revoked by it.

## Isolated Loom account test target

Kyle selected Loom as the first L84 target and Migadu for test email. The Loom runtime uses
pairing/scoped client sessions; it does not create email/password users. The following local
operator workflow proves session provisioning and reset without enabling the pool's gated login
adapter or contacting live identity, the Library, OpenBao or the VPS.

From this checkout, using installed Node/Python and dependencies:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 apps/server/src/fork/vault/testkit/loom_test_instance.py prepare
PYTHONDONTWRITEBYTECODE=1 python3 apps/server/src/fork/vault/testkit/loom_test_instance.py start
```

`start` stays in the foreground; retain its terminal session. It uses only
`.t3/vault-app-test`, with a marker, a synthetic project, three stopped threads and all agent
providers disabled. Its synthetic workspace has its own local Git repository with no remotes;
startup proves the Git toplevel with an isolated discovery ceiling and refuses a missing,
redirecting, empty or incomplete Git boundary. The child process uses a separate `sandbox-home`
for HOME, XDG, gh and provider state; global Git config is sandboxed, system config disabled and
Git prompts disabled. The parent process HOME is unchanged. This is configuration isolation,
not an OS sandbox for programs with full host access.

Existing marked fixtures are preserved and modified provider settings refuse. Preparation runs
only while the target is stopped. Empty/partial seed directories can be retried; disabled-provider
settings are written before the completion marker. A completed fixture missing its settings gets
those disabled defaults restored. A database published without a completion marker is preserved
under `incomplete-seeds/<id>/` before a fresh seed, rather than adopted or deleted. The seeder's
installed-state guard always uses the actual account's `.t3`, independently of child HOME. Nothing installs or builds a release. Read actual ports from the
`[dev-runner]` line; the preferred web/backend ports are 7673/15713, and occupied ports can shift.
Use the private startup pairing link in an isolated browser profile. Do not publish the token.
Do not set `VITE_HTTP_URL` or `VITE_WS_URL`. Keep runtime logs private.

Once the target is listening, run in a second terminal:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 apps/server/src/fork/vault/testkit/loom_test_instance.py prove
```

The proof checks target identity and unauthenticated refusal, creates a five-minute read-only
session, reads the three synthetic threads, revokes it, verifies refusal, issues a replacement,
verifies the old credential still refuses and revokes the replacement. Reports contain results,
never tokens. Cleanup queries only the invocation's unique subject, including after a lost mint
reply, and verifies that no matching active session remains. Cleanup failure fails the proof;
a killed harness may leave a credential valid until its five-minute expiry. Do not interpret
this as durable cleanup, browser logout, pool reset, data wipe or authority to mark an account
clean. The test target needs no Vault backend and changes no execution gate.

Pause edits to `apps/server/src/`, `packages/` and `apps/server/package.json` while running the
proof: the server dev script watches all three and restarts the target. If a restart interrupts the proof, wait for its next listening message and
rerun; the partial invocation's session expires within five minutes. Keep the instance for local
inspection, then stop its retained terminal session or the exact PID captured at launch. Never
kill by name or substitute installed userdata. The harness has no delete/reset-database command. Its Git transport is file-only, but it is not
an OpenSSH sandbox: do not configure Mini SSH workers or SSH device hosts in this target,
because direct SSH features still resolve the account's real passwd-home `.ssh` paths.
A hard-killed fixture writer can leave a non-secret temporary file under userdata or beside the
test home in `.t3`. It is never adopted. Remove only the exact orphan identified from your own
stopped run; do not sweep other instances' temporary files.

## Dedicated Migadu test mailbox handoff

Kyle confirmed that `vault@begam.in` exists in Migadu and is dedicated to Vault tests. Live
reader setup and message acceptance are not yet configured. Runtime session
provisioning above does not send verification email; email tests will be a separate adapter proof.
No VPS or Library deployment is needed for the local target.

The mail owner can prepare the following in the existing Migadu dashboard:

1. Preserve the existing dedicated `vault@begam.in` mailbox. No mailbox creation is needed.
2. Create a custom-password identity for the test reader, scoped to that mailbox, with IMAP
   access enabled. The gated contract expects the proposed login `vault-reader@begam.in`; its
   creation and access have not been verified. Disable sending, POP and ManageSieve for that identity. Keep the organization
   API key and the mailbox administrator password outside worker access.
3. Verify a harmless message to `vault+loom-<run-id>@begam.in` arrives in that mailbox. Migadu
   supports plus addressing without creating aliases for each run and normally sorts each tag
   into an auto-created `loom-<run-id>` folder, rather than Inbox. A domain Pattern Rewrite
   `vault+*@begam.in => vault@begam.in` can route it to Inbox instead; the mail owner must review
   that rule before changing it. Do not add catch-all routing,
   forward personal mail or change working DNS for this check.
4. Until L79's production backend, controls and audit path are explicitly approved by the host
   owner, custody of any live reader secret is **Kyle-only in 1Password**. It is not an agent
   credential or an input to this lane's synthetic fixtures. Never put it in the disposable
   OpenBao proof backend, this worktree's test state, a thread or git. No live reader secret
   has been created or exported by this work. The future reader uses verified TLS to
   `imap.migadu.com:993` and must correlate the exact test recipient/run in the selected tag
   folder or the explicitly configured Inbox route, without marking seen or deleting messages.
5. Before enabling deletion or reuse, choose a retention/cleanup policy covering both per-tag
   folders and Inbox-routed mail. Prove that another run's folder/messages cannot be selected
   or removed. No folder or message deletion policy is silently assumed.

The Migadu [management API](https://www.migadu.com/api/),
[identities](https://www.migadu.com/guides/identities/),
[plus addressing](https://www.migadu.com/guides/plus_addressing/) and
[connection settings](https://www.migadu.com/support/) describe these separate responsibilities.
The API manages mailboxes/identities; incoming messages use IMAP. No live mailbox, management API,
SMTP or IMAP request has been made by this lane. A later hosted test instance remains a host-owner
handoff behind the applicable L79 identity/custody/policy gates; this local setup does not clear them.
