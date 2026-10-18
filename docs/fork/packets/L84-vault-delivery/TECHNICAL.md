# L84 technical design

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
credential-use token. SSH delivery must bind the actual operation payload to a new supported
proof and recheck current policy immediately before its side effect. No provider adapter gets
keys or launch environment changes from this milestone. Authenticated Loom MCP callers across
providers share the same tool path; external clients, inactive/background-only callers and
runtimes below full-access/default cannot open sessions. Actual Pi/provider delivery is pending.

Local workload identities currently use the same owner-only file mechanism as host identity,
in separate directories outside the current working tree. Release/expiry invalidates sessions;
it does not erase those operator-owned keys. Two signatures prove possession, not isolation
from another process with the same OS-user filesystem privileges. Workload/process launch
attestation and restricted sockets remain selected work, not a completed security boundary.

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
