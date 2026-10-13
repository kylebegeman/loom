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
- Remaining acceptance is physical keyboard use and additional actual display scales. Workstation native keyboard navigation, cancellation, default Keep current, reviewed temporary none preset apply/restore, native Hyprland reload and larger-dialog rendering at scale 1.25 now pass. Laptop hardware and suspend/wake acceptance remain with packet #15.
- Native review found historical Restore recreated an absent shortcuts.json file. The patch records original preference bytes or absence and preserves them through restore and interruption recovery. Both focused regressions pass. Installed .50 apply/restore removes the generated preference file normally, restores the exact native bindings, and preserves all 39 recorded file/mode checks. Readability returned to its exact original system preference. The original test on .49 required guarded cleanup of only its test-generated preferences; no personal edits were overwritten.
- Final installed pack 20261013.51, SHA256 a9fbcc5e59a89bd42f2e6988e260d3fec08783c55d0d4d2318e821815faddf9f, passes owner verification and ready commissioning. All 381 pack tests, scoped lint and 62 focused tests against the frozen Linux .50 runtime pass; .51 changes only launcher description/icon metadata. Actual .51 to .50 rollback/reapplication passed. Iris Dark, existing Atlas window and T3 PID 1154 are preserved. This is native virtual-input/current-scale proof, not a physical keyboard or every display certification.
