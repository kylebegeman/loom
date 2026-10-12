# 17. Coordinated updates and recovery

Present compatible component updates and their recovery mechanisms without surprising active work.

Status: **approved**. Complexity: **Large**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: [#9](09-omarchy-compatibility-checks.md), [#10](10-reproducible-loomos-setup.md), [#13](13-native-workstation-control-desk.md).

## Scope

- Describe component versions, channels, compatibility and expected restart/interruption.
- Preserve existing component release ownership and custom fork origin; coordinate supported maintenance around active work.
- Expose stage/apply/verify/recover states and appropriate rollback boundaries per component.

## Acceptance

- Check incompatible versions, offline metadata, interrupted updates, active jobs and recovery.
- Never silently replace the fork with upstream or restart an active environment.
- Separate pack rollback, client update and system/package recovery guarantees.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

No completion evidence yet. Approved scope remains open.
