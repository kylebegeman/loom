# 6. Shortcut and accessibility presets

Make native actions comfortable on different keyboards and readable displays.

Status: **verification_pending**. Complexity: **Small**. Impact: **High**.

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
- The controls are installed in verified Workstation pack 20261012.43. Its actual native compatibility report resolves both Shortcuts and Readability commands and reports no interrupted shortcut update. Pack .43 -> .42 -> .43 rollback/reapplication preserves preferences, Iris appearance and the running service; earlier isolated .16/.14 checks cover personal and synthetic app/credential-state preservation.
- Live baseline: shortcuts.json is absent, while native Lua callbacks provide the standard Super+Ctrl+Alt+L/O/A/N/F chords; Loom actions has no configured shortcut. readability.json is version 1 with size system. Preserve that preference-file absence and existing personal bindings during acceptance.
- Remaining Workstation acceptance: inspect Shortcuts and Readability, keyboard cancellation and Keep current, temporary reviewed preset apply/restore with the native Hyprland reload, then text-size selection/restore and actual Alacritty rendering at the current display scale. Real physical-keyboard and other display-scale checks remain unverified; laptop hardware and suspend/wake acceptance are deferred. Installed state and remaining checks: /Users/kyle/Developer/artifacts/loom-os/2026-10-12/workbench-desk/packet17-readiness-audit.md. The current 40-entry preservation baseline records missing shortcuts.json: /Users/kyle/Developer/artifacts/loom-os/2026-10-12/maintenance/preservation-before.json.
