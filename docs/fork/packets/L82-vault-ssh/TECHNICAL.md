# L82 technical design

Target design drafted against `2f385ee835`. Kyle authorized implementation and selected
OpenBao for encrypted storage. The implemented boundary is specified below; remaining imports, general terminal attachment and
additional Git operations still need implementation review.
Read the [foundation proposal](../LOOM-VAULT-FOUNDATION.md) for identity, storage, delivery,
permission ceilings and retry semantics; these constraints are not reimplemented per packet.

## Implemented boundary

`vault-ssh.ts` specifies safe key metadata, generation/trust inputs, the command payload and its
result. `VaultSsh` stores a versioned private-key envelope through `VaultCore` into existing
OpenBao item paths. Generation uses a caller-held item/operation ID; repeated creation returns
the same public identity, while competing creation conflicts. Trust has independent CAS and
retry semantics. Null trust blocks use. Archive/delete and trust changes block old-version
commands; they do not remove public registrations from remote hosts or destroy KV history.

`VaultWorkloads` issues an `ssh-exec` challenge whose dual signatures bind the command digest.
The digest includes exact argv, expected item version and timeout. Consuming that challenge is
single-use; check/release proofs cannot execute commands. Session ownership, active run/mode,
machine approval/heartbeat and the persisted item/destination use decision are revalidated.
`VaultSsh` verifies the item version/destination, then rechecks policy and version before spawn
and during agent requests, including before signing. There is no reusable readiness capability.

`SshTransport` runs `/usr/bin/ssh` from the control plane, ignoring user/system SSH config,
existing agent sockets, connection multiplexing, password/keyboard prompts, proxy commands,
forwarding and known-host stores. It writes only public identity and known-host files in a
private temporary directory. `SshCrypto` implements identities, session-bind and a narrow signing
subset: verify the pinned Ed25519 host signature on the exchange session ID, then require a
host-bound SSH user-authentication message for that session, user, host key and assigned key.
Generic signing, forwarded bindings, unknown identities and additional signatures fail closed.
This requires host-bound-capable OpenSSH and Ed25519 host keys; IPv6 and SSH certificates are
not implemented. Hostnames/IPv4 addresses are explicit, with no SSH aliases or discovery trust.

Four simultaneous commands are allowed. Agent frames/queues/sockets and command/output sizes
are bounded. Each command runs for at most eight seconds and returns at most 2 KiB stdout;
SSH stderr is drained but not returned or logged. Nonzero remote exits are reported in JSON;
255 or signal termination is a transport failure. A scoped finalizer kills only its own SSH
child, waits for close, closes sockets and removes public temporary files after success, failure,
timeout or cancellation. An abrupt server kill may leave public temporary files. No private key
file is created. Remote command effects can survive disconnect; a lost response has an unknown
outcome. Consumed challenges reject retry; a fresh proof can repeat the remote effect.

Revocation prevents new signatures/operations when checked. It does not recall an already
issued signature or roll back an authenticated remote command. The mediated operation exposes no generic socket to
workloads; explicit terminal activation adds the restricted local relay described below. Neither
path returns a private key or bearer capability in its result. Same-user processes can
still read backend token/identity files or interfere with server memory/sockets; this is not an
OS isolation boundary. Production host isolation, boot custody and operational recovery remain
separate design gates.

The HTTP endpoint is `/api/loom/vault-brokers/workloads/ssh-exec`. Administrator MCP generation
and trust require a human full-access client; threads can inspect public metadata only with an
inspect grant. Existing signed runner/CLI transport makes execution available to authenticated
Loom agent terminals without an administrator/backend token. Existing provider/task launches
also expose hosted tools that create/release the operation's session automatically. Explicit per-command terminal attachment is described below; persistent shell attachment and
remaining native-harness environment setup remain unfinished. General readiness stays conservative and does not perform this probe
automatically.

The separate `vault-ssh-management` capability advertises `loom.vault-ssh.info`, `generate`,
`trust` and `probe` RPCs. Public inspection requires environment access:read; mutations and
the explicit administrator probe require access:write. Clients use protected destination-bound
commands, shared inventory invalidation and public-key/fingerprint parsing in client-runtime.
Core archive/restore refreshes mounted SSH details; generation/trust refreshes mounted item
lists across atom factories. Web/desktop use a dialog and native mobile a sheet with copy,
confirmation, busy/error and archived/read-only states. Older servers hide these entry points.

The administrator probe uses the same strict transport and shared four-operation concurrency
limit, but fixes argv to `/usr/bin/true` and timeout to eight seconds. It rechecks administrator
authority and exact active item version before transport, while signing and after completion.
Only destination, fingerprints, version, timestamp and authentication evidence are returned.
This is an explicit human administration operation; arbitrary workload execution continues to
require its signed session and persisted use grant. MCP rejects agent callers for the probe.
Separate RPC handler layers avoid TypeScript recursion limits without weakening handler types.

## Hosted Git and automatic workload access

[L85's implemented boundary](../L85-vault-delivery/TECHNICAL.md#automatic-access-through-provider-launches)
owns session setup using the existing authenticated provider connection. `VaultSsh.git` consumes
an independent `git-exec` proof binding repository, action, server checkout, timeout and key
version. It verifies the exact repository grant and rechecks active policy/item state at
transport/signing and after completion. The shared transport runs Git ref listing/fetch through
the scoped pinned agent, with 30-second/64-KiB limits and process-group cleanup. SSH remains
8-second/2-KiB. Neither operation installs a persistent socket or changes the personal vault.

## Explicit terminal SSH agent

`VaultSsh` owns activation, ordered channel frames, inspection and close. `VaultLaunch.agent`
uses the configured enrolled server identity and a fresh workload key to prove a normal
`check` challenge. The resulting five-minute workload session is retained only after successful
activation; a failed open releases it. The authenticated MCP caller must own the session's
current full-access/default run. Each frame rechecks host presence/approval, current run,
provider, item state/version and use policy. Closing removes both activation and workload.
Restart invalidates all activations. Metadata/session references alone confer no access.

A session exposes one public identity. Each channel permits one verified session binding and
one host-bound authentication signature, with strict increasing sequence numbers. Replay,
generic signing, forwarded bindings, wrong hosts/users and stale item versions fail. Per-session
serialization prevents concurrent signing/replay races. Sessions are capped at 64 globally,
with the workload limit of eight per thread; each retains at most 32 channels and 65 frames per
channel. Frames are canonical base64 with at most 16 KiB decoded bytes. Private key material is
loaded behind the service boundary and is never returned to the local terminal.

OpenSSH authentication does not sign a Git repository path. Agent activation therefore needs a
use grant covering the SSH host destination, rather than treating a repository-specific grant
as general signing authority. The existing mediated Git proof still enforces exact repository
scope. Session binding proves the pinned host key and username, not network hostname/port.
The local launcher's argument validation enforces the configured hostname/port, while the
signing service enforces host-key/user identity. Neither is an isolation boundary against a
same-user full-access process with access to server files, memory or sockets.

`SshAgentClient` recognizes complete explicit `LOOM_MCP_ENDPOINT`/`LOOM_MCP_AUTHORIZATION`, ACP
`T3_ACP_MCP_ENDPOINT`/`T3_ACP_MCP_AUTHORIZATION`, or Pi `T3_MCP_URL`/`T3_MCP_BEARER_TOKEN`
pairs, in that order. It never mixes partial credentials from different families. Authenticated
requests reject redirects, bound responses and timeouts, and surface normalized errors.

`SshAgentTerminal` runs on the invoking host. It creates a private local socket, public identity,
known-hosts file and destination-validating SSH launcher for one child. Git uses that launcher
through `GIT_SSH`; direct SSH uses it too. OpenSSH ignores personal configuration, passwords,
forwarding and multiplexing and requires pinned Ed25519 host-bound authentication. The child
receives its own HOME/config, safe Git defaults and socket, with no inherited personal agent or
MCP bearer credentials. Git executes its ordinary argv in the invoking terminal's checkout;
clone/fetch/push do not rewrite existing remotes. This activation grants host authentication,
not repository-specific control of arbitrary Git arguments or filesystem/checkout attestation.

Four local sockets and eight queued frames are allowed per activation. The foreground CLI
preserves child streams and exit status, prints safe activation failures to stderr, and closes
the socket, public files and owned process group on normal exit, timeout or cancellation. The
selected timeout is at most five minutes and never extends server expiry. An unreachable close
can leave a server session until expiry; it cannot grant offline signing. Abrupt SIGKILL can
leave public temporary files. Revocation blocks future signatures, but cannot recall a signature,
terminate an already authenticated remote connection or undo remote effects.

This is explicit per-command activation; it does not alter the enclosing provider shell.
Codex and Claude receive private per-session connection descriptors automatically through the
[L85 native session boundary](../L85-vault-delivery/TECHNICAL.md#native-terminal-session-connection).
Pi and ACP expose their existing connection variables. Cursor, Grok, OpenCode and Muse use
hosted MCP tools or explicit terminal connection configuration; their automatic propagation
remains open. Antigravity follows ACP. Web/desktop/mobile retain the existing key, host-trust and
grant management entry points; no new client UI or upstream provider seam is introduced.

## Overview

Generate or explicitly import keys, keep private material behind the broker signing interface, and track public-key registrations and host trust independently. Give workloads a restricted identity set through platform-appropriate agent transport. Validate destination constraints using supported SSH mechanisms or a mediated connection, not an assumed hostname in generic signing requests.

## Contracts and authorization

Key generate/import/list/publicKey/test/archive/remove and host-trust inspect/accept/remove are separate operations. Signing endpoints accept an authenticated workload and authorized identity; they never return private key bytes. Do not promise remote revocation until registration removal is confirmed.

Use the implemented packet-owned `loom.vault-ssh.*` RPC schemas for client management.
Additional imports and delivery operations need their own reviewed schemas. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Store encrypted versioned key material and fingerprints centrally. Keep known-host trust scoped to Loom environments. Local sockets and temporary public-key/config files have private ownership and bounded lifetimes; forwarding is disabled unless deliberately supported.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use `loom_vault_ssh_*` names if exposed and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Inspect packages/ssh, device-host SSH and MiniSshTransport independently. Prefer a shared credential adapter; do not rewrite base SSH arguments globally or relax host-key checking.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.
