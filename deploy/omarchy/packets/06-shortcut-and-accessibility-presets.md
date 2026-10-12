# 6. Shortcut and accessibility presets

Make native actions comfortable on different keyboards and readable displays.

Status: **ready_for_deployment**. Complexity: **Small**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: [#1](01-discoverable-loom-action-menu.md).

## Scope

- Offer conflict-checked shortcut presets with preview, restore and user-customization preservation.
- Show actual configured bindings instead of claiming default bindings are active.
- Support readable native terminal sizing and accessible focus/contrast choices through existing controls.

## Acceptance

- Check conflicts, invalid bindings, preset apply/restore and personal edits.
- Verify complete keyboard interaction and readable layouts at common display scales.
- Physical keyboard acceptance is recorded separately from command/virtual-input checks.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

- Implemented native menu/action/CLI controls for Standard, Compact, per-action overrides, explicit disabling, reviewed conflict adjustment, restore and interrupted-update recovery.
- 112 focused pack tests pass on macOS and native ARM Linux, including 12 shortcut tests and five upstream-parser compatibility tests. Focused lint, formatting and generated-document checks pass.
- Live-binding preflight refuses occupied chords, duplicate proposals, unavailable sessions and edited owned blocks. Review snapshot checks preserve concurrent personal changes; recovery refuses later edits.
- Readability controls provide per-window Alacritty text/padding without changing global terminal settings, plus existing native Font/Theme actions. The sizing recovery screen remains reachable if Alacritty becomes unavailable.
- Actual Linux Gum 2.0.0 terminal interaction checks pass for cancellation, keeping current settings, conflict adjustment, reviewed apply, exact binding restore and readability selection/restore. Hyprland, renderer presence and font dispatch are synthetic; these checks are not Workstation physical/display acceptance.
- Prepared immutable pack 20261011.16, SHA256 2a60f42b7a8f69a53cb837f8b7b96cd7e158f590b5006b901887e613c93bc9f4. Actual retained .14 upgrade, dry-run, rollback and return preserve preferences and synthetic app/credential state on macOS and native ARM Linux.
- Workstation SSH currently times out. Installation, native reload/display review and physical keyboard acceptance remain pending; no network settings, running services, real app data or Iris shared tokens were changed.
