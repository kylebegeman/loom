# 4. Guided connections

One resumable flow explains app sessions, private network and shared AI setup.

Status: **completed**. Complexity: **Medium**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: [#1](01-discoverable-loom-action-menu.md), [#12](12-shared-app-integration-contract.md).

## Scope

- Discover existing app and CLI authorizations without copying browser credentials.
- Open required app approval pages automatically and guide private network/hub setup.
- Expose connected, approval-needed, unavailable, retry and revoke/forget states.

## Acceptance

- Resume partial setup after cancellation or restart without repeating completed approvals.
- Check expired device codes, revoked sessions, server/hub outage and unavailable Secret Service.
- A person can complete ordinary setup without entering shell commands or pasting scripts.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

- Implemented one native connection flow through the installed Loom connections launcher, LoomOS menu, action catalog, connection-status console and CLI. Current app CLI authorizations, Tailscale and Switchboard determine progress; reopening does not repeat completed approvals. Browser credentials remain inside the owning apps.
- Guided recovery opens existing app approval/access pages and Tailscale controls. Gateway restoration and masked client-key import delegate to Switchboard. Confirmed app CLI disconnect delegates revocation to its owning client and removes only the selected app/origin search key; offline server revocation remains explicit app-owned follow-up.
- 143 focused integration-pack tests pass, including eight guided-connection tests for partial setup/reopening, expired approval retry, refused and unavailable access, unavailable Secret Service, stdin-only secret import, disconnect confirmation and absent-key cleanup. Focused lint, formatting and generated-view checks pass.
- Installed immutable pack 20261012.27 on Workstation from committed source 66fc9adf4a. All 27 bundle members match committed source; manifest SHA256 1fa4e0f0a22cb3bba1d1868e971bedaa99033d8020d66a267a5379f6ecd19566. Installed compatibility/ownership checks pass on Omarchy 4.0.0.alpha; pack 20261012.26 is retained and verified for rollback.
- Native acceptance verified installed launcher and native-menu dispatch, connected Office/Atlas CLI and private AI states, original Office/Atlas window reuse, cancellation/reopening, and the default Keep connected confirmation. Fixed a real absent-key Secret Service cleanup error and Gum screen-transition artifacts. Existing configuration SHA256 9dce07b11f516fee66c28f5f1c91022bb424a74c55ef40b823ec914cac17c6ef, Iris theme and t3code.service PID 1152 are preserved.
- Evidence: /Users/kyle/Developer/artifacts/loom-os/2026-10-12/connections/. Live acceptance reused existing personal sessions; failure/revocation/expired-approval paths use isolated tests. No personal access was revoked, no personal records were created, no paid provider inference or server restart was used, and no new app/hub release was needed.
