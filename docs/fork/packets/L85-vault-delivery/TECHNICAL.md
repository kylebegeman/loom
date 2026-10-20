# L85 technical design

Target design drafted against `2f385ee835`. Kyle authorized implementation and selected
OpenBao for encrypted storage. Packet-specific contracts still need implementation review.
Read the [foundation proposal](../LOOM-VAULT-FOUNDATION.md) for identity, storage, delivery,
permission ceilings and retry semantics; these constraints are not reimplemented per packet.

## Implemented workload-check boundary

`vault-workloads.ts` defines public session bindings and canonical dual-signature requests.
`VaultWorkloads` captures active run/provider/project identity from ThreadManagement; MCP takes
only the authenticated caller's thread ID. It enforces full-access/default mode, one exact
item/destination use grant, approved host state and a live heartbeat. Every channel check
rechecks these boundaries after challenge issuance. `VaultAccess.require` persists the policy
decision before success; backend/audit failure prevents an allowed result.

Sessions are process-local, capped at 64 total and eight per thread, and expire in five minutes.
They do not survive control-plane restart or restore. Challenges last at most 30 seconds, bind
environment/machine/session/request/operation, require both keys, and are single-use. Consumed
entries remain until expiry to reject replay; there are at most 128 challenges and four per
session. A copied public binding file is not sufficient authority. List recovers public bindings
if an open response is lost; opening again may create a second bounded session.

`BrokerHttpClient` shares origin validation, redirect rejection, 15-second timeouts, 16 KB
responses and typed failure handling across host and workload runners. `WorkloadRunner` checks
local key/binding/connection consistency and response bindings. Its CLI runs signed check or
release requests without administrator/backend bearer tokens. Cleanup does not need the item
grant; signed release allows an overdue heartbeat, while a disabled host fails closed. The
owning active MCP thread can close sessions, and expiry also releases control-plane state.

The service exposes authorization checks only. Its result must never be accepted as a future
credential-use token. L82 mediated SSH binds the actual command payload and key version to an `ssh-exec` proof and
rechecks current policy before spawn/signature. Future delivery modes must do the same. No provider adapter gets private keys or secret launch environment changes. Authenticated
Loom MCP callers across providers share the tool path. External clients, inactive/background-only
callers and runtimes below full-access/default cannot open these hosted sessions. Automatic
operation-scoped SSH/Git access through that existing channel is described below.

Local workload identities currently use the same owner-only file mechanism as host identity,
in separate directories outside the current working tree. Release/expiry invalidates sessions;
it does not erase those operator-owned keys. Two signatures prove possession, not isolation
from another process with the same OS-user filesystem privileges. Workload/process launch
attestation and restricted sockets remain selected work, not a completed security boundary.

## Automatic access through provider launches

`vault-run-access` advertises `loom_vault_ssh_exec` and `loom_vault_git`, also available as
`loom vault ssh-exec` and `loom vault git` through the authenticated MCP CLI. Existing
provider-session setup supplies the thread-bound connection. `VaultLaunch` derives the
principal from that connection; it does not accept a thread ID, machine ID, private key,
working directory or arbitrary remote URL from tool input. Scheduled agent runs use the
same path, including new threads under project grants. Command-only scheduled jobs do not.

An operator configures `LOOM_VAULT_EXECUTION_BROKER_DIR` on the Loom server after enrolling
and approving that server's broker identity. Its existing foreground broker keeps heartbeats
current. Configuration is a private-directory path, not a bearer token. `VaultLaunch` reads
that owner-only machine identity and connection, creates a separate workload key only in
memory, and acquires a session for the actual current run/item/destination. It signs a fresh
operation-bound challenge with both identities, executes through L82 and closes the session
on success, failure or cancellation. Closing also removes that session's outstanding challenges.
No manual session file or workload key transfer is required for these hosted operations.
The existing standalone runner remains supported separately.

This is on-demand attachment through the MCP channel established at launch. It does not
install a generic agent socket, set `SSH_AUTH_SOCK` or `GIT_SSH_COMMAND` in a provider's shell,
or make ordinary shell Git commands use Vault. Full-access/default mode, online host state,
current use grants and item version remain authoritative; old check results grant no use.
A missing/unconfigured directory or offline broker fails explicitly. Control-plane restart
invalidates sessions; the next authorized operation obtains a fresh one.

A small `ext-vault` seam adds fork-owned guidance to the shared provider instructions. Pi
receives it through its real `before_agent_start` system-prompt hook; Codex through application
context; Claude, Cursor, ACP, Grok and OpenCode through their existing common instruction paths.
Antigravity uses its existing ACP path. The tools remain authoritative if a provider ignores
text or lacks a particular instruction channel. Guidance names tools only when exposed,
contains no item values or authority, and does not cause another MCP process per provider.
No secret environment variable is added to provider processes.

## Explicit terminal agent delivery

L82 adds `loom vault ssh-agent-exec` and run-owned agent open/frame/list/close tools. A successful
signed workload check retains the five-minute session until explicit close or expiry; failed
activation releases it. The terminal gets public metadata and signatures, never private key
material. New frame requests revalidate the active run, provider, host, item version and grant.
The temporary local socket and ordinary SSH/Git child run on the invoking host. Host SSH grants
are required because generic SSH authentication contains no repository path. The hosted Git
operation below remains the repository-scoped option. See
[L82](../L82-vault-ssh/TECHNICAL.md#explicit-terminal-ssh-agent) for client setup, transport and
revocation limits. Existing provider processes receive no new credential environment variables.

## Git operation boundary

Git supports `ls-remote` and `fetch` from the thread's current server checkout. The service
resolves that checkout from thread/project records. Repository paths are bounded, exclude
shell/options, empty components and dot traversal, and are bound into a `git-exec` proof with
action, checkout, timeout and exact item version. Check/release/SSH proofs cannot authorize Git.
The grant destination is `git+ssh://user@host:port/team/repo.git`. Absolute repository paths
use `git+ssh://user@host:port/:absolute/path/to/repo.git`. A host-scoped SSH grant alone does
not match that destination; an unrestricted destination grant still intentionally covers it.

`SshTransport` runs `/usr/bin/git` with a canonical SSH URL and the same private scoped agent,
host-bound authentication and pinned host key. Git uses an isolated HOME, no global/system
config or credential helper, disabled hooks, no submodules or automatic maintenance, and only
the SSH protocol. Existing repository config is not rewritten. Fetch updates `FETCH_HEAD` and
objects; it does not merge, change origin, or set up tracking branches. No clone/push yet.
Git is bounded to 30 seconds and 64 KiB stdout, sharing four-operation capacity with SSH/probes.
Its local process group, including SSH children, is cleaned on cancellation/timeout. Results
retain the Git exit code; CLI JSON does not turn it into the CLI process exit status. Errors,
timeout and lost responses may follow a completed fetch; there is no automatic retry or rollback.
The key and any returned remote output have the same trust limits as the SSH milestone.

The machine key remains owner-only plaintext under existing broker custody. Same-user
filesystem/process privileges can bypass these application boundaries. No OS process isolation,
boot unlock, production GitHub login or personal-key migration is established by this slice.

## Overview

Provide a broker-backed CLI, SDK and MCP facade over shared use requests. Prefer purpose-specific SSH agents, Git helpers and authenticated service calls; support scoped environment and temporary-file delivery where tools require raw secrets. Keep management APIs separate from delivery and attach workload identity at launch.

## Contracts and authorization

Resolve/use/release and CLI exec operate on typed references, a workload capability and an intended delivery method. MCP returns safe delivery handles or executes a supported operation; raw values are not normal tool output. Explicit human reveal/export is managed separately.

Use packet-owned `loom.vault-delivery.*` RPC methods if Loom transport is needed; authorization-check schemas
are implemented; actual delivery schemas remain a design-review output. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Persist safe delivery receipts and lease IDs. Keep material in memory or private temporary files only as required; never use command arguments, prompt context or repository files. Environment delivery exposes values to the receiving process, so policy cannot promise protection from that process.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use `loom_vault_delivery_*` names if exposed and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Inspect provider session process environment and shared turn-input hooks. Reuse Pi's existing system-prompt channel; add capability-aware guidance without embedding credentials or requiring a separate Vault MCP process for every provider.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.

## GitHub command-scoped delivery

The existing authenticated MCP boundary now supports explicit gh and Git HTTPS argv, including
fetch/push/clone, in the active thread checkout. A private child environment and exact-repository
Git helper carry credentials; the CLI preserves streams/exit status. Current run/version/grant
checks, process cleanup and token release remain authoritative, independently of readiness.
This does not install a persistent shell environment, migrate SSH remotes or certify every
provider's terminal MCP environment. The shared contract and limits are in
[L83 technical design](../L83-vault-connectors/TECHNICAL.md#github-terminal-routing-and-readiness).
