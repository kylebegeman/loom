# L77 technical design

Target design drafted against `2f385ee835`. Kyle authorized implementation and selected
OpenBao for encrypted storage. Packet-specific contracts still need implementation review.
Read the [foundation proposal](../LOOM-VAULT-FOUNDATION.md) for identity, storage, delivery,
permission ceilings and retry semantics; these constraints are not reimplemented per packet.

## Overview

Combine declared expiry, connector validation and delivery failures into deduplicated issues keyed by item and failure class. Perform bounded, rate-aware background checks. Close resolved issues, preserve useful history and distinguish provider outages from revoked credentials.

## Contracts and authorization

`list`, `recheck`, `snooze`, `unsnooze` and `dismiss` operate on issue IDs with revision checks. Read operations never trigger provider login. Repair delegates to the owning connector rather than replacing credentials directly.

Use packet-owned `loom.vault-health.*` RPC methods if Loom transport is needed; exact schemas
remain a design-review output. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Persist issue state, fingerprint, next eligible check, safe evidence and resolution timestamps. Retention and notification frequency are configurable design decisions. Do not store provider response bodies or secret-containing URLs.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use `loom_vault_health_*` names if exposed and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Register background work in the fork service layer. Existing scheduler turns are not required for health checks; avoid generating agent conversations for maintenance.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.

## Implemented boundary

`VaultHealth` owns the environment-scoped OpenBao `health` CAS record. It bounds rules to 128,
issues to 256 and mutation receipts to 32; omitted issue counts are visible. Repeated failures
update the same item/category issue. Safe labels, versions and timestamps are retained, never
provider bodies, command output, tokens or login URLs. Issue disposition changes are reversible.
Snooze expiry is evaluated against the clock; clients use deadline timers rather than repaint loops.

`VaultHealthChecks` scans at most 25 opted-in due rules per minute with concurrency two and a
15-minute interval per item. Explicit rechecks also enforce a 30-second burst limit. Read-only
snapshot calls perform no login. Claim CAS is committed before a provider probe. Completion
rechecks the item version, claim deadline and newer observations, so removed rules, replacements
or newer resolutions cannot be overwritten by an older probe. The claim accompanies nested
connector observations; ordinary operations use their start timestamp for the same stale-result check. A sealed/unreachable backend
leaves the worker unable to check rather than authorizing credential use.

Default expiry warning is seven days; the typed rule supports one to ninety. The initial
notification destination is the inbox, with no external messages. Automatic provider validation
requires explicit administrator opt-in for a dedicated GitHub connection and named repository,
or the saved SSH connection.
Unattended checks use that recorded authorization and do not grant agent access. Local client
management requires access:read/write. CLI/MCP management is limited to authenticated full-access
administrator clients; an agent thread cannot change global health state or trigger an admin probe.

Operation observation is diagnostic. A health-store failure never converts a completed remote
write into a failure that could cause duplicate retries. Nonzero child exits do not resolve
credential health. Network/timeouts remain separate from authentication; generic SSH connection
failures become review issues without claiming that the key was revoked. Account/provider revocation
is never performed by this service.

`VaultHealthContext` inspects current profile bindings and grant references for one item. It
uses the environment's project store and existing profile/access services, sorted by project ID,
with ten projects per page and two concurrent profile reads. Thread grants resolve to the
thread's current project. References with deleted/unknown threads or projects contribute to an environment-wide unattributed-grant count, rather than silently disappearing. Valid grants on other pages do not contribute to that count. Suspended/revoked grants and
archived profiles retain their labels and state, without being represented as usable authority.
The response contains only metadata. Project and registry failures return an error rather than
an empty-success result. Each page is a current inspection, not a transaction across registries.
Reads can still race edits; use the actual access inspector and launch checks for authorization.

The additional `vault-health-context` capability gates clients against older health servers.
Its protected read RPC, administrator MCP tool and `health-context` CLI command call the same
service. Clients request context only after expansion, can close/refresh/page it, and can review
the selected project's profiles or grants. The page also returns the ten scanned project identifiers, including those without current
references, so retained selections can be inspected independently.

`retained` calls the existing profile pin service for one project and one page of at most 25
selections. It filters matching bindings by item ID and returns their pinned item/profile
versions and authoritative retirement availability. The cursor advances over every inspected
selection, including unmatched and retired entries. A retired tombstone has no resolution and
cannot be attributed to any item; the response reports that uncertainty as a count. Projects
without current bindings remain selectable. This lookup neither mutates pins nor claims
current workload authorization. Review and retirement reuse L76's existing controls and checks.
Web handoff stores the requested project in the Vault navigation atom and routes by environment,
so the profile picker owns project selection rather than the global settings scope.
The separate `vault-health-retained` capability guards this addition; `scannedProjects` is
optional on older context responses. External consumers and provider-side copies remain
undiscovered. Optional structured coverage accompanies both responses, including empty/final pages. It identifies page scope, external consumers as not discovered, provider copies as unknown and current authorization as not evaluated. Missing coverage on older servers renders an explicit unknown notice. No field or empty page should be interpreted as proof external consumers do not exist.

SSH validation reuses the existing pinned-host probe with its fixed `/usr/bin/true` command
and eight-second timeout. The optional rule field defaults to no SSH validation for existing
records. SSH and GitHub validation are mutually exclusive; configure validates their item kinds.
The current item/version and host trust are rechecked by the SSH service. These diagnostics do
not grant workloads credential use. A timeout creates an outage issue; untrusted hosts and
other SSH failures create configuration issues without claiming revocation or authentication
failure. A successful probe resolves prior validation issues through the same stale-claim guard.
The existing opt-in, interval, burst and concurrency bounds apply. Clients gate the new form
control on `vault-health-ssh-validation` and retain explicit automatic-check consent.
