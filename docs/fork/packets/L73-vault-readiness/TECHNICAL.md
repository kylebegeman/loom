# L73 technical design

## Implemented boundary

General readiness checks OpenBao connectivity, authenticated run liveness and up to 16
item/action/destination requirements through the shared execution evaluator. Empty requirements
inspect the current run's retained profile and pinned versions, then the project default only
when no pin exists. Profiles are optional; no profile means no connection has been selected,
not a missing setup requirement. SSH/Git requirements inspect enrolled-broker presence.
Results name the Loom server context, include repair guidance and expire after 60 seconds.
Web/desktop and mobile can cancel a pending check; RPC, CLI and MCP share the bounded service.

Use/reveal/export requests and empty requirements retain an unsupported live-delivery check.
Configuration and broker presence never prove selected-host execution or upstream login.
An allowed personal-mode or grant decision does not prove item-write privileges, SSH/GitHub
authentication, host trust, provider tools or unattended launch readiness. Dedicated GitHub
API/GH CLI/Git HTTPS probes remain a separate connector operation.

Shared contracts are in `packages/contracts/src/fork/vault-access.ts`; implementation is
`apps/server/src/fork/vault/VaultAccess.ts` and `VaultPolicy.ts`. The active contract is in
[EXTENSION-POINTS.md](../EXTENSION-POINTS.md#loom-vault-foundation-ext-vault).

Policy is one OpenBao KV v2 CAS document at
`environments/<sha256(environmentId)>/access-policy`, separate from item records. It caps grants
at 128, resources per grant at 32, audit retention at 256 and mutation receipts at 32. Policy
revision changes on authorization-policy edits, including owner-mode changes; audit writes still
CAS against the backend version. Decisions must persist before authorizing a gated action. Four
contention attempts fail closed. This is a bounded operational history, not an immutable audit
service.

RPC tags are `loom.vault-grants.catalog`, `.snapshot`, `.apply`,
`loom.vault-access-inspector.preview`, `.explain` and `loom.vault-readiness.check`. Inspection
uses access:read and mutation uses access:write. MCP names are `loom_vault_grants`,
`loom_vault_grants_apply`, `loom_vault_grants_preview`, `loom_vault_access_explain`,
`loom_vault_readiness` and `loom_vault_grants_delegate`. There is no raw-value agent tool.

## Remaining target design

Selected-host broker/runner execution, live SSH/additional provider checks, broader failure
classification and integrated remote/platform acceptance remain. Profile discovery, retained-pin
revalidation, observational broker presence and launch/schedule configuration guards are
implemented. Dedicated GitHub probes use the connector readiness service. Future external
checks may need durable long-running operation records; the current bounded observations do not.

The following sections retain the complete target design where it exceeds this milestone.

## Overview

Run bounded checks inside the actual broker or runner context. Resolve selected resources or
optional profile requirements, verify unlock and access policy, and exercise harmless
provider-specific operations such as repository reads. Classify authentication, authorization,
network, host-trust and missing-tool failures separately; record check time and environment
identity.

## Contracts and authorization

`run` accepts environment, optional project/profile and bounded check selection; returns a run ID. `read` returns per-check state, timestamp and safe recovery guidance. `cancel` stops unfinished checks. Cancellation and network failure never rewrite credentials.

Use packet-owned `loom.vault-readiness.*` RPC methods if Loom transport is needed; the current schemas are in the shared contract. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Keep bounded diagnostic summaries and timestamps in the environment metadata store. Do not persist command output, environment dumps, device codes or credential values. Define freshness and retention at design review.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use `loom_vault_readiness_*` names if exposed and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Inspect GitHubHostSetup and runner launch preparation. Prefer adapter registration; do not insert credential probing into the pure orchestrator.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.

## GitHub execution checks

The connector now owns bounded, cancellable API/GH CLI/Git HTTPS probes, an optional active
thread/run/use-policy check, provider identification and 60-second freshness. Host-only checks
leave run access unchecked; denied runs skip external probes. This does not change the earlier
general readiness endpoint's conservative broker/delivery conclusions or certify a separate
runner/provider-terminal environment. The shared execution/cleanup contract is in
[L83 technical design](../L83-vault-connectors/TECHNICAL.md#github-terminal-routing-and-readiness).

## Profile and broker context integration

`VaultReadiness` composes the existing execution evaluator, project profile configuration and
terminal enrollment-presence observation. The RPC and MCP paths use it, including the existing
CLI alias and web/native readiness views. Explicit requirements stay authoritative; only an
empty set inspects the current run pin or, when none exists, the project default. No profile is
required; an absent optional selection does not authorize any connection. Discovery never
activates a profile, writes a run pin, sends SSH traffic or contacts GitHub. Configuration
previews use no-thread mode to avoid access-audit writes; the existing readiness evaluator
separately checks each derived use scope. Missing/untrusted bindings remain blocked with repair
guidance.

Use checks report current provider/run permission mode. SSH/Git use additionally reports whether
any approved broker has current presence; that is not a proof of the selected execution machine,
unlock custody or upstream authentication. The existing unsupported delivery/live-probe check
remains, so configuration and presence cannot produce an unattended-login success claim. Inspect
checks need neither broker presence nor project defaults. Locked/unconfigured backend reports
return before registry reads, preserving the useful backend state. Changed run/provider/project
or profile revision during awaits adds a visible blocking refresh check. Reports remain finite
observations with the original 60-second freshness window, never execution tokens.
