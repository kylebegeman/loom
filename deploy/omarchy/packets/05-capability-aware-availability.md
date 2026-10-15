# 5. Capability-aware availability

Show what can actually be used when parts of the ecosystem are unavailable.

Status: **completed**. Complexity: **Medium**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: [#4](04-guided-connections.md), [#12](12-shared-app-integration-contract.md).

## Scope

- Extend the existing status widget using app-owned offline and pending-change capability reports.
- Distinguish cached reading, supported writing, live search, AI and owning workstation availability.
- Reject stale status after suspend and offer explicit recovery without resubmitting work.

## Acceptance

- Verify disconnected, partially connected, revoked and reconnect states against app-owned contracts.
- Inspect status with keyboard and pointer; do not rely only on color.
- Polling stays bounded and never refreshes provider usage or performs inference.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

- Implemented the What works now launcher, menu/action entries, native recovery utility and version 2 Loom status widget. App-owned declarations distinguish Office supported offline reading/writing from Atlas server-only behavior; current CLI, private AI and workstation checks remain separate.
- Current app contracts explicitly decline device cache/outbox reporting. The UI shows conditional prior-use support and unconfirmed pending changes, never invented cached data or a zero queue. Retained declarations contain build metadata only, are origin-bound and expire after seven days; they cannot restore live search or authorization.
- 151 focused pack tests pass, including disconnected/partial/revoked/reconnect, retained declaration expiry/origin/tampering, clock gaps/backwards movement, strict widget validation and read-only recovery. Focused lint, formatting and generated-document checks pass.
- Native Quickshell fixtures passed actual pointer and keyboard activation, simulated sleep clearing readiness before a new sample, fresh resume, disconnected/partial/revoked/reconnect states and non-invented pending counts. The real logind observer is active. Physical machine suspend was not used while background work is running.
- Installed immutable pack 20261012.28 on Workstation from committed source f6cd47274d; all 28 bundle members match source. Manifest SHA256 aee580c3364882ab5af7385bffa3122a10fdf78193df27060b8f64848fa3b354. Ownership/compatibility pass on Omarchy 4.0.0.alpha, previous .27 verifies for rollback and no activation is pending.
- The native widget required Omarchy supported shell restart because live file watching is disabled and plugin rescan retained old components. The unlocked-session restart activated the new widget without restarting t3code.service PID 1152 or the apps. Real pointer dispatch, installed launcher, menu navigation, owner-app window reuse and utility-to-guided-setup recovery passed. Input readiness/frame timing was corrected in the verifier after an initial misselection; fixture/scenario proof is distinguished from live personal-session checks.
- Configuration SHA256 9dce07b11f516fee66c28f5f1c91022bb424a74c55ef40b823ec914cac17c6ef, Iris theme and original Office/Atlas windows are preserved. Polling is bounded, resumes discard pre-sleep results without cancelling an owning credential refresh, and recovery does not resubmit work, refresh provider usage or invoke inference. Evidence: /Users/kyle/Developer/artifacts/loom-os/2026-10-12/availability/. No app/server release, account revocation or new browser/pending-count reporting is claimed.
