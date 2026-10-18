# L81 technical design

Target design drafted against `2f385ee835`. Kyle authorized implementation and selected
OpenBao for encrypted storage. The implemented boundary is specified below; remaining imports and
launch integration still need implementation review.
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
issued signature or roll back an authenticated remote command. No generic socket is exposed to
workloads, and the returned JSON contains no key or bearer capability. Same-user processes can
still read backend token/identity files or interfere with server memory/sockets; this is not an
OS isolation boundary. Production host isolation, boot custody and operational recovery remain
separate design gates.

The HTTP endpoint is `/api/loom/vault-brokers/workloads/ssh-exec`. Administrator MCP generation
and trust require a human full-access client; threads can inspect public metadata only with an
inspect grant. Existing signed runner/CLI transport makes execution available to authenticated
Loom agent terminals without an administrator/backend token. Per-provider launch attachment
remains unfinished. General readiness stays conservative and does not perform this probe
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
