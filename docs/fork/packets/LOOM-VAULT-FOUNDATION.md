# Loom Vault shared foundation

Status: implementation authorized. OpenBao is selected; the encrypted-record boundary is
implemented in `ext-vault`. Broker, platform identity and delivery portions below describe the full
target and must not be mistaken for implemented guarantees. This work creates no live infrastructure. Product intent and decision
owners are in [LOOM-VAULT.md](./LOOM-VAULT.md).

## Implemented reference and profile boundary

L73/L75 now provide metadata search, stable environment/item references and project-local
SSH/Git/GitHub profiles through existing shared `ext-vault` services and client state. Profiles
hold no values. First use durably pins a profile revision and key versions for the active run;
current policy/key/host/archive checks still gate execution. OpenBao paths and retention limits
include manual terminal-run retirement with durable tombstones and retained OpenBao history,
and are documented in [L75 technical design](./L75-vault-profiles/TECHNICAL.md). Explicit composer/scheduled-prompt links now require blocking server preflight. Portable
declarations, additional kinds and run-pin cleanup remain selected.

## Implemented GitHub command boundary

Explicit terminal gh/Git HTTPS requests reuse authenticated active-run access and the selected
connection/version/repository. The CLI preserves streams and exit status; no surrounding-shell
login or SSH migration occurs. API/GH/Git HTTPS readiness is cancellable, expires after 60 seconds
and reports server context plus optional provider/run access. Independent runner and native
provider-terminal setup remain outside these probe guarantees. See [connector design](./L82-vault-connectors/TECHNICAL.md#github-terminal-routing-and-readiness).

## Implemented record boundary

`packages/contracts/src/fork/vault-core.ts` and `apps/server/src/fork/vault/` implement
versioned KV v2 records with per-environment namespaces, safe metadata pages, explicit protected
human reveal, CAS lifecycle changes and request fingerprints. Private input goes through
`VaultPrivateInput` and a destination-bound `SecretRequests.transfer`; a committed receipt can
be returned after its one-use input is consumed. This transfer extends the existing private
input store, which remains owner-only plaintext until the value reaches OpenBao.

Human management uses environment access:read/access:write. Authenticated threads now need
per-item grants for metadata, private ingress and lifecycle operations, under T3's permission
ceiling. The shared VaultAccess service provides online policy, bounded safe decision history,
previews and server-context readiness. There is no raw-value MCP tool. Reviewed hosts and process-local workload checks are
implemented below; full delivery leases, immutable audit and platform-account integration remain unfinished.

## Implemented policy boundary

Policy is encrypted in an environment-scoped OpenBao CAS record. Thread/project allow grants
are unioned under default deny and specify exact item IDs, actions, optional project and exact
destination, start/expiry and parent lineage. Delegation requires an attested direct subagent
in the same project and cannot broaden actions, resources, scope or lifetime. An ancestor's
suspension, expiry or revocation invalidates descendants. Revocation is permanent; create a
new grant to restore access. There is no offline policy cache or new credential-delivery path.

Grant mutation receipts retain 32 results; a matching operation/actor/request retries safely.
Audit retains 256 events and exposes omitted counts; this is operational history, not the final
immutable ledger. Decision audit persistence fails closed. Item writes and policy checks are
separate backend operations, so this is not an OS isolation boundary or a distributed lease.
Same-user full-access agents can access host files and are not contained by these grants.

Readiness covers at most 16 declared requirements and expires after 60 seconds. It explicitly
names the Loom server context, does not probe SSH/GitHub, and reports missing broker/delivery
support for use/reveal/export. Profile discovery, launch preflight and external probes remain
in the complete packet targets.

The exact active extension contract and existence checks are in
[EXTENSION-POINTS.md](./EXTENSION-POINTS.md#loom-vault-foundation-ext-vault).

## Existing foundation and the actual gap

Source baseline: `2f385ee835` on 2026-10-17. Current code is useful integration context, not
proof that a managed Vault exists:

- [`ServerSecretStore.ts:138`](../../../apps/server/src/auth/ServerSecretStore.ts#L138)
  defines a byte store. Its [write path](../../../apps/server/src/auth/ServerSecretStore.ts#L189)
  writes supplied bytes to owner-only files. Filesystem permissions are not encrypted Vault storage.
- [`settingsSecrets.ts:35`](../../../apps/server/src/settingsSecrets.ts#L35) maps sensitive fields
  to secret slots and redacted settings. Reuse this separation at an explicit adapter boundary;
  do not silently migrate upstream provider/auth state.
- [`SecretRequests.ts:52`](../../../apps/server/src/secrets/SecretRequests.ts#L52) supports private
  input and one-use references. Extend the principle for deliberate imports, not a secret-returning
  agent interface.
- [`GitHubHostSetup.ts:330`](../../../apps/server/src/sourceControl/GitHubHostSetup.ts#L330) and
  [`GitHubSetupFlow.ts:21`](../../../apps/server/src/sourceControl/GitHubSetupFlow.ts#L21) manage
  GitHub setup/progress. HTTPS helper configuration does not rewrite existing SSH remotes.
- [`GitHubCredentials.ts:133`](../../../packages/source-control-github/src/server/GitHubCredentials.ts#L133)
  resolves CLI credentials. Explicit Vault selection needs an adapter without changing existing
  auth precedence for unmigrated projects.
- [`DesktopShellEnvironment.ts:433`](../../../apps/desktop/src/shell/DesktopShellEnvironment.ts#L433)
  hydrates a missing agent socket for desktop. This is not host enrollment or headless policy.
- [`DesktopSshPasswordPrompts.ts:280`](../../../apps/desktop/src/ssh/DesktopSshPasswordPrompts.ts#L280)
  requires a window for its prompt. Remote Vault decisions must be services independent of Electron.
- [`mcpExtensionSource.ts:454`](../../../packages/provider-pi/src/server/mcpExtensionSource.ts#L454)
  already supplies Pi system context. Credential access needs execution integration, not more
  credential-bearing prompt text.

Kyle identified repeated approvals by a personal SSH key manager on Dorothy. Machine inspection
in this design conversation confirmed GitHub SSH used the 1Password agent. This is problem
context, not machine configuration committed here or a claim that every authentication error
has the same cause.

## Proposed responsibilities

**Central authority:** encrypted records, versions, principal/grant administration, authenticated
leases, requests and minimum audit. Candidate home is Kyle's VPS with verified begam.in/platform
identity integration. Expose a versioned service API independent of the Loom transport.

**Execution-host broker:** machine/workload authentication, bounded lease acquisition, per-workload
credential channels, cleanup and truthful readiness. It runs without an Electron window and
selects only development identities explicitly bound to a workload.

**Loom integration:** typed fork RPC/HTTP/MCP/CLI adapters and shared client-runtime state.
Management remains usable from web, desktop and mobile. Host filesystem and credentials belong
to the execution environment. Platform UI can be a separate client of the same authority.

**Backend adapter:** hides engine-specific storage, key and issuance interfaces. It must report
capabilities and preserve policy/error semantics. It cannot treat a backend token as permission
to skip Loom's own workload authorization.

## Backend selection and alternatives

| Option                                              | Why evaluate                                                                           | What the disposable proof must establish                                                                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Maintained engine such as OpenBao                   | Existing secret engine and operating model may reduce custom sensitive infrastructure. | Actual feature/API fit, supported auth, encryption/unseal, export/restore, version behavior, license and maintenance on the selected release.                      |
| Application-oriented service such as Infisical      | Existing developer-secret workflows may fit accounts/projects and SDK ergonomics.      | Self-hosted feature availability, machine identity, permission semantics, delivery/offline options, recovery, upgrade process and license on the selected release. |
| Narrow Loom-owned service using supported libraries | Product-specific records and broker semantics may justify a smaller custom API.        | A maintainable key hierarchy, authenticated encryption, recovery, operational ownership and no improvised cryptographic algorithms.                                |

**Decision:** Kyle selected self-hosted OpenBao behind Loom's product surfaces. OpenBao 2.7.1
(MPL 2.0) passed a disposable Raft/KV v2 proof for CAS, encrypted persistence and clean restore.
The alternatives above retain the comparison context, not parallel implementation plans. Document
version/license and operational constraints before adding dependencies. A database choice,
including PostgreSQL, remains open; no SQL/schema is specified in this design pass.

## Shared model and lifecycle

Use conceptual objects below to settle behavior before defining schemas:

- **Vault item:** stable opaque ID, kind, owner/scope, safe display metadata and lifecycle state.
  Payload versions are encrypted and separately addressable. Account records, SSH keys, connection
  material and secure files are typed records, not unstructured global environment variables.
- **Reference and binding:** an item ID with a declared requirement/usage. A name is not an access
  token. A binding includes destination/project/environment context and a reviewable revision.
- **Principal:** verified human, host, service or workload identity. Human admin and machine use
  are distinct. A prompt, filesystem path or claimed thread ID cannot attest a principal.
- **Grant:** principal/resource/action/context/time decision with provenance and a revision.
  Delegation only narrows access. Inspect, manage, use, reveal and export are different actions.
- **Lease/use handle:** bounded authority for a specific delivery operation; it may refer to a
  static item version or provider-issued credential. Renewal re-evaluates authorization.
- **Operation/request:** durable ID, expected revisions, idempotency scope, progress, terminal
  outcome and safe error detail. Approval and secret input are separate request kinds.
- **Audit record:** actor/workload, item/version reference, operation, safe destination, grant
  revision, outcome and time. Never include secret values, auth codes, signed URLs or raw outputs.

Archive/restore preserves references without permitting new use while archived. Delete explains
known bindings and retention; physical deletion and upstream revocation are different outcomes.
If a kind cannot be restored or an external mutation cannot be reversed, preview that irreversible
step. Do not offer a cosmetic undo that cannot restore the provider-side state.

## Implemented host enrollment boundary

Shared `vault-brokers.ts` and `VaultBrokers` implement reviewed Ed25519 enrollment and signed,
single-use online heartbeat challenges. OpenBao holds the environment-scoped CAS registry;
local identity files are owner-only plaintext, outside the current working tree. The runner
holds no central backend token. Web/mobile and administrator CLI/MCP share service methods;
agent threads cannot approve themselves. See [L79](./L79-vault-brokers/TECHNICAL.md).

The macOS/Linux process proves machine identity and renews two-minute presence. It can run
in the foreground or as a separately managed launchd GUI-user/systemd-user service. macOS
requires login; Linux/Pi boot/logout continuity requires an available user manager and configured
linger. Status distinguishes those prerequisites from current presence and backend lock state.
Presence alone does not attest a workload, issue credential-use leases, sign SSH or provide offline use. A same-user agent can read the broker's local identity file. Restore from
an old backend snapshot can restore older approvals; revocation reconciliation remains part of
recovery. Those limits apply even when the UI shows Online.

## Explicit terminal SSH activation

L81 now adds run-owned SSH agent activation for one local SSH/Git child, using the existing
MCP authority and a signed five-minute workload check. Host-bound signing and current grants
remain on the server; private keys never enter the terminal. This requires host SSH access,
since an SSH authentication message cannot bind a repository path. Exact repository-only use
stays on the mediated Git path. Pi/ACP terminal connections work with their existing variables;
remaining native harnesses need explicit terminal configuration. See
[L81](./L81-vault-ssh/TECHNICAL.md#explicit-terminal-ssh-agent) for lifecycle and trust limits.

The shared OpenBao adapter now uses a versioned serialized payload to avoid engine JSON
string-count limits for bounded audit/registry records. It reads legacy records, preserves
paths/CAS and rejects unknown formats. Older readers cannot read newly encoded records;
rollback requires matching application/backend recovery versions. No live data was converted.

## Implemented workload authorization checks

L84 adds five-minute sessions bound to the authenticated active run, provider, project, enrolled
machine, item and destination. Separate machine/workload signatures protect single-use check
and cleanup requests. Policy and runtime permissions are checked again after the challenge.
Sessions are intentionally invalidated by control-plane restart; they do not extend durable
grants into offline authority. No credential delivery or OS process isolation is established by
these checks. See [the exact boundary](./L84-vault-delivery/TECHNICAL.md).

## Implemented mediated SSH

L81 generates dedicated Ed25519 keys into existing encrypted item records and keeps host trust
independent of user-key identity. Administrator clients can pin/replace/remove a host key;
ordinary workloads cannot approve their own trust. A command-bound dual proof authorizes a
short mediated connection from the Loom server. A private scoped agent verifies the host's
exchange signature and signs only the assigned host-bound user-authentication payload. It does
not expose a generic workload signing API or private-key files. See [L81](./L81-vault-ssh/).

This milestone requires online policy/backend availability and a reachable target. Revocation
prevents new signatures at subsequent checks; remote effects and already-issued signatures
are not recalled. Web/desktop/mobile management now includes key creation, public copying,
reviewed trust replacement/removal and a fixed authenticated administrator probe. That probe
uses the same transport with Vault write rights; agent arbitrary commands still need a signed
workload and use grant. General readiness does not invoke it. Existing provider/task launches
now attach authenticated SSH/Git tools with on-demand workload setup/release. Git ref listing
and fetch are mediated on the Loom server using a repository-specific grant and current thread
checkout. The operator enrolls/configures the server broker once; its private identity remains
owner-only plaintext and the workload key is memory-only. Ordinary shell Git/SSH, clone/push,
imports and general runner sockets remain pending. No real account migration, service deployment or global SSH configuration changed.

## Key custody and headless unlock

D2 must identify who can decrypt, how wrapping keys are protected, what the service receives at
startup and how recovery works with the primary host unavailable. Encryption keys placed beside
their ciphertext offer little protection against the same filesystem compromise.

An OS-protected key, external unlock authority or explicit operator bootstrap are possibilities,
not universal solutions. Document availability while locked, after logout and after reboot for
each supported operating mode. A user LaunchAgent starting at login is not a system daemon
starting before login. Do not promise unattended macOS operation from launch configuration alone.

Protect secret payloads and sensitive metadata according to the selected engine design. Define
limits on secure files, temporary material, exports and plaintext lifetimes. Normal clients load
metadata, never the entire Vault. A human reveal/export flow requires explicit rights and its own
audit; it is not a general-purpose agent read endpoint.

Baseline storage completion includes a successful encrypted backup/restore demonstration with
separately available recovery material. V16 builds ongoing verification, management and migration
on that baseline. Recovery cannot be postponed until after real credentials are entrusted to Vault.

## Authentication, grants and delegation

A broker authenticates the host and binds each use to a real workload launch. T3 invocation
identity and environment authorization are useful evidence inside T3, but external scripts need
an independently authenticated enrollment/delegation flow. Do not trust an environment variable
or socket filename as the sole proof of workload identity.

Existing T3 access remains a ceiling: a Vault grant cannot turn a read-only MCP client into an
administrator or override a destination environment denial. Add protected RPC methods to the
fork permission registry and use `createEnvironmentRpcCommand` availability in clients. Enforce
the final decision server-side immediately before use, including after a queued request resumes.

A full-access process can inspect values deliberately delivered to it and may access other files
owned by its OS user. A Vault grant is not a sandbox. If hostile workload isolation is required,
choose OS-user/container/VM boundaries and enforce broker access across those boundaries.
SSH agent protocol access alone does not prove a destination hostname; validate supported
OpenSSH destination constraints or mediate connections before claiming host-scoped key use.

## Offline operation and revocation

The implemented policy milestone evaluates online and has no offline decrypted cache or
personal-agent fallback. Future broker use leases are still proposed as online-only acquisition;
their offline lifetime and production outage behavior require review.

If D5 selects offline access, define encrypted cache contents, allowed operations, effective
expiry, trusted-clock behavior, restart rules and maximum revocation delay. A disconnected
broker cannot learn a fresh revocation immediately. Display the remaining offline lease bound.
Online disable/revoke blocks new acquisition; stopping an existing process and revoking a
credential at its provider require separate supported operations. Already delivered secrets
cannot be recalled from memory or arbitrary external copies.

## Delivery and failure semantics

Prefer purpose-specific delivery: SSH signing, Git credential helper, provider API call or
browser-session binding. Raw environment variables and private temporary files are allowed only
when the consumer requires them and the grant allows that delivery mode. Never put values in
argv, prompt context, repository files, RPC snapshots or ordinary MCP results.

Do not promise universal redaction of arbitrary child output. Broker/service paths must avoid
logging secrets and test with synthetic canaries; a process intentionally printing a delivered
value remains a trust/isolation issue. Temporary files need private creation, cancellation/crash
cleanup and explicit handling of platform differences.

Mutations carry idempotency keys scoped to authenticated principal and operation. A pending
operation is not success. Persist accepted work and decisions before effects, reconcile uncertain
provider results, and never retry account creation/issuance as a fresh operation after a timeout.
Use typed unsupported, locked, denied, expired, conflict, unavailable and external-operation-failed
outcomes. Error summaries identify the failing stage without carrying raw credential output.

## Proposed extension contract and integration

`ext-vault` is proposed as shared interfaces for metadata/private ingress, policy evaluation,
authenticated principal contexts, broker sessions, delivery adapters, audit and operation state.
The first implementation promotes a minimal agreed specification with existence checks into
EXTENSION-POINTS.md in its own commit. That specification must say which parts are mandatory
for safe use and which are optional capabilities. No packet copies this prose as executable code.

Reserve `loom.vault.*` for the shared extension. Feature RPC tags use their packet slug; this
avoids a feature taking ownership of the common namespace. Schema and service code remain in
fork-owned paths. Exact API/storage shapes, migrations, error unions and exports are the design
review output, after engine and identity decisions. Existing registries handle services, RPC,
settings, palette, CLI, MCP and optional turn-input guidance.

Keep Vault worker I/O out of the pure orchestrator. Durable launch preparation and side effects
use supported V2 services/effects. Scheduled tasks and delegated children use the same access
path as interactive turns. Review every installed provider adapter separately; none receives
values in a system prompt. Shared capability-aware guidance points to reference selection,
readiness and recovery tools.

Clients tolerate missing capability and version skew. Older/upstream T3 servers continue working.
Use bounded metadata pages and operation subscriptions, avoid per-item continuous polling, and
never move encrypted payloads through client snapshots simply because they are encrypted.

## Recovery, audit and operations

Define a minimum durable audit interface before use is enabled; the access inspector is a
consumer rather than the owner of that evidence. Select retention, administrator visibility,
backup coverage and behavior when audit persistence fails. Do not claim an audit trail is
immutable against an administrator controlling its storage unless a selected mechanism proves it.

Restoring an older backup can resurrect old grants and machine credentials. Promotion requires
an authoritative revocation reconciliation or deliberate invalidation/re-enrollment of restored
principals. Define that behavior even if the old server and latest log are unavailable. A local
Vault delete is not proof that a provider token was revoked or that an old backup was erased.

A later operating runbook covers isolated staging, upgrades, monitoring, TLS/auth routing,
capacity, rate limits, rollback and recovery. Reuse the existing VPS/platform deployment system
after inspecting its contracts. This documentation does not authorize changing DNS, exposing a
new public endpoint, installing production dependencies or deploying a database.

## Verification contract

- Unit/contract tests use synthetic credentials, deterministic clocks and explicit async milestones.
- Backend adapters prove encrypted persistence, wrong-key/corruption failures, idempotency and restore.
- Broker tests prove launch identity, service restart, bounded outage behavior and cleanup.
- Policy tests prove no escalation through delegation, aliases, retries or changed revisions.
- Integration proves Dorothy-style SSH/GitHub work without personal approval, across runners and remote clients.
- Client verification covers loading/empty/error/unsupported states, keyboard/screen-reader access and reverse actions.

Each packet owns its focused behavior checks. Run actual tests and relevant consumer typechecks
when code exists, not guessed paths during this documentation change. Browser/device verification
still requires the session's applicable authorization. No live secrets or personal vault exports
are test fixtures.

## External evaluation references

- [OpenBao documentation](https://openbao.org/docs/): candidate maintained secret-engine model.
- [Infisical self-hosting documentation](https://infisical.com/docs/self-hosting/overview): candidate developer-secret service.
- [OpenSSH manual pages](https://www.openssh.com/manual.html): agent, SSH configuration and host-trust semantics.
- [OpenSSH agent destination restrictions](https://www.openssh.com/agent-restrict.html): validate constraints before claiming destination-bound signing.
- [Git credential helper interface](https://git-scm.com/docs/gitcredentials): integration boundary for broker-backed Git access.
- [GitHub authentication documentation](https://docs.github.com/en/authentication): evaluate supported account/app access and revocation.

These are official references for ongoing adapter and operational research. OpenBao is selected;
no production OpenBao instance has been installed by this work. Verify supported versions, licenses and APIs in
the relevant design review before reusing code, adding dependencies or promising capabilities.

## Dedicated GitHub milestone

L82 now adapts github.com App installations and dedicated tokens through encrypted core records.
Mediated GH uses exact repository grants, stable current run/version checks and isolated temporary
CLI configuration. It does not give ordinary terminals GitHub credentials or isolate same-user
full-access processes. App session tokens are repository-limited and released best effort; local
disconnection, provider revocation and OpenBao history are distinct outcomes. The [L82 design](./L82-vault-connectors/TECHNICAL.md)
records implementation limits and the selected onboarding/connector work still to do. GitHub project bindings now reuse the
profile/run-pin boundary, with configuration/grant preflight and named mediated GH execution.
Version 2 declarations omit all local connection/repository bindings; SSH/Git exports retain
version 1. Configuration review is distinct from live provider/API or CLI readiness.
