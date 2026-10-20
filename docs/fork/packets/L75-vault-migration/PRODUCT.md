# L75 product

## Delivered read-route previews

After a fresh successful SSH repository-read verification, inspect cutover and rollback previews
for the selected project, remote, fetch entry and exact Git path. Reopening or refreshing asks
the server to recheck the source, receipt, item version, host trust and destination read access.
Preview data disappears while refresh fails or its evidence expires. Close the preview or cancel
the replacement plan to leave it. Web/desktop and mobile controls share the existing migration
state per surface, so cancellation invalidates the receipt displayed by the other views.

The proposed change routes repository reads through the selected Vault SSH reference. Ordinary
terminal authentication and project configuration are not changed. Push operations, embedded
authentication, omitted entries and local URL rewrites are outside eligible preview scope.
GitHub API receipts never establish Git transport eligibility. The rollback view reverses the
proposed route only; it is not an applied rollback, a restorable backup or proof the original
credential still works. Future execution must independently verify original access and compare
the exact applied forward state. Neither preview authorizes any write or creates a workload grant.

## Original development route and recovery design

A reviewed SSH fetch plan can verify a separately selected original development key already in
Vault. The source must name the SSH user explicitly, and the key's user/host/port must match.
The selected record must be active, pinned and distinct from the replacement record. Separate
human review and provider-contact confirmations precede a fixed repository read. Missing trust
fails before SSH access. Default users, local SSH-command overrides, aliases, ambiguous routing,
personal agents and API-only evidence cannot establish this route.

The receipt identifies the explicitly selected development key, not whichever key an old shell
happened to use. Development-only ownership is a human attestation. The surrounding terminal's
authentication and workload grants remain unevaluated. Original and replacement attempts have
independent identities and retry/recovery state; expiry, source/item changes and cancellation
invalidate usable evidence. No private credentials are returned.

With fresh passing evidence for both routes, inspect a recovery snapshot design. It proposes
capturing the selected nonsecret fetch entry and a future managed-route manifest in the existing
encrypted ledger. It captures nothing now and is not a restorable backup. Proposed recovery
uses intent and preimage/postimage reconciliation, with conflicts requiring review. The capture
engine, actual route-writer integration and protection against concurrent external writers remain
open decisions. Preview refresh hides failed or expired evidence; close the preview or cancel
the plan to leave it. Cutover, rollback and configuration writes remain unavailable.

## Summary

Replace selected interactive development dependencies with dedicated Vault credentials.

## Implemented first step

Open **Vault development imports** in the selected computer's Loom settings or command
palette. On mobile, use that computer's settings. Enter one development-only secret or secure
note, confirm that it is separate from personal accounts, and review the destination and new
record before explicitly importing. The review expires after ten minutes. It creates no item
until apply is accepted. Clearing the form discards local private input; cancel ends a prepared
review. Reopen a review to inspect its receipt or reenter the same value for retry.

Archival affects only the unchanged newly imported record, preserves encrypted history, and
can be reversed using Vault's existing restore action. It does not revoke a provider credential.
Use the dedicated SSH and GitHub connection flows for their typed records. This first step
never inspects personal stores, bulk exports or files, and does not establish usable workload
access. The complete workflow below remains selected.

## Delivered typed development imports

The same Vault development imports settings include a capability-gated typed form for one
dedicated SSH key, GitHub token or GitHub App identity. SSH supports unencrypted Ed25519 PKCS#8
PEM and OpenSSH envelopes, with an explicit user/host/port and optional independently verified
host public pin. GitHub requires the expected account and repository allowlist; App imports
also require App and installation IDs and an unencrypted RSA PEM key of at least 2048 bits.
Encrypted and unsupported keys are refused locally. No file, personal vault or credential
manager is inspected, and no provider is contacted.

The ten-minute review shows only public metadata and scope. Separate development and review
attestations are mandatory. Closing clears private input; reopening requires reentry of the
same canonical material. Cancellation creates no item. Commit creates one new typed item,
with interrupted-response recovery and guarded archival only while the imported item remains
unchanged. Restore through Vault management. Format validation does not prove development-only
ownership, account ownership, host identity or service access. Existing grants and all Git
transport configuration remain untouched. Cutover/rollback/configuration-write gates remain false.

## Implemented inventory and replacement planning

Open **Vault migration plans** in the selected computer's settings or command palette. Inspect
project dependencies, choose a reported remote, then choose a dedicated existing Vault SSH key
or GitHub App/token record. Preparing requires a development-only statement; recording review
requires a separate confirmation of the replacement, scope and computer. Reviews last ten
minutes, can be reopened by receipt, and can be cancelled even after being reviewed.

Inventory reads only selected local Git configuration at registered project roots. It reports
fetch URLs and explicit push URLs separately, sanitizes endpoint hints, preserves safe exact SSH
Git paths, and reports omitted entries. It never invokes helpers, SSH or authentication. Global
and included configuration, SSH aliases, environment overrides and account identity remain
unknown. A missing explicit push URL does not imply that pushes have no credential dependency.
Local URL rewrites require separate review. Unsupported sources are visible without a plan action.

SSH plans concern mediated SSH Git operations and report missing host trust. GitHub App/token
plans cover API and `gh` operations; they do not replace SSH or HTTPS Git authentication. The
server checks source freshness, candidate type, endpoint/repository and active item version.
This is metadata matching, not verification of provider access or development-only ownership.
Every plan requires explicit verification and forbids cutover. Plans create no identity,
grant, profile, provider session or configuration change. Source-specific verification is implemented below; preview-only read routing is implemented; configuration execution remains unfinished.

## Implemented verification receipts

After recording a reviewed plan, explicitly allow a verification attempt against the saved
destination. SSH checks read refs from the exact repository using the dedicated key and pinned
host, without fetching or using project/global SSH authentication configuration. Missing host
trust blocks the attempt. GitHub checks repository API access through the selected App/token;
that receipt does not prove Git transport or local `gh` readiness.

Results record their scope, source/item binding, outcome and expiry. Read-only refresh never
contacts a provider. Evidence lasts at most one minute and is bounded by plan/token expiry;
source/item changes, cancellation and lost permissions during the check prevent usable success.
A successful historical receipt cannot promise that a provider has not revoked access since.
Workloads still need their own current grants. No receipt authorizes a repository change.

A lost response can be inspected or retried with the same request, without repeating an
accepted provider check. If the final outcome could not be recorded, the receipt becomes
interrupted rather than successful; a new attempt requires another explicit confirmation.
Cancel the replacement plan to stop further credential use, while an already started remote
read may finish. Native/live-provider/remote acceptance and configuration cutover remain pending.

## How it works

Inventory configured credential sources without extracting personal vault contents. Prepare a reviewed change set for dedicated key generation, service reconnection, explicit imports and optional repository configuration updates. Record prior non-secret configuration for rollback and test replacement access before cutover.

## User experience

See which projects depend on 1Password or a personal CLI account, choose replacements, inspect each proposed change and apply only selected changes. Cancel before cutover, retry a failed step or restore the prior configuration.

## Why it improves the product

Makes the personal/development separation achievable without breaking unrelated tools.

Complexity: **Medium**. Impact: **High**.

## Entry points and reverse actions

The flows above must be reachable through the Vault workspace, their relevant project or
environment context and discoverable palette actions. CLI and agent access follow the
technical service boundary. Each mutable flow includes cancellation or an explicit irreversible
step, plus a way to inspect its current state. Narrow/mobile layouts retain task context and
restore focus when a dialog closes.

## States

Show loading, empty, ready, permission denied, unsupported, locked and disconnected states
where applicable. In-progress work is cancellable where the external operation permits it;
otherwise report the committed operation and reconcile its eventual result. Never show success
because a request was merely accepted. Use accessible labels and textual status, not color alone.

## Surfaces and connection modes

Web and desktop: management and inspection are required through the shared client runtime.
Mobile: the equivalent management/status flow is required, including private input and pending
requests when relevant. CLI and MCP call the same services, with narrower rights where needed.
Local, direct remote, Tailscale, relay and tunnel connections must address the selected execution
environment. An upstream or older server without the capability shows unavailable without
breaking its normal workflows. The proposed platform web surface uses the same authority and
never reads a remote environment's credentials from the browser's local machine.

## Dependencies and future opportunities

Uses foundation import, connector and SSH adapter interfaces when available; missing adapters leave a clear unconverted item. Unlocks migration of existing projects and additional hosts.

## Decisions and open questions

Confirmed: Kyle selected this complete idea for implementation. The personal/development Vault
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- Initial private input is one manually entered development secret or secure note. File/bulk and typed connector formats still need adapter-specific review.
- Prefer a fresh dedicated identity; imported records are always newly allocated. Full replacement and cutover orchestration remains unfinished.

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.
