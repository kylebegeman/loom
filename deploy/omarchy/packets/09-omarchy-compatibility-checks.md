# 9. Omarchy compatibility checks

Catch upstream changes before an integration release breaks everyday controls.

Status: **approved**. Complexity: **Medium**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: None.

## Scope

- Test supported Omarchy parsers and native actions alongside current synthetic pack tests.
- Cover themes, menu entry points, app window reuse, runtime/config preservation and installer ownership.
- Record supported Omarchy versions and meaningful compatibility failures in release evidence.

## Acceptance

- Reproduce known parser/theme-picker failure modes in focused regressions.
- Check current and retained-release install/rollback, personal edits and interrupted activation.
- Run actual Linux/native checks when a target is available; distinguish fixtures from physical acceptance.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

No completion evidence yet. Approved scope remains open.
