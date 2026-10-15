# 9. Omarchy compatibility checks

Catch upstream changes before an integration release breaks everyday controls.

Status: **completed**. Complexity: **Medium**. Impact: **High**.

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

- Implemented read-only native menu, Loom actions and CLI compatibility reporting for the installed parser, stock Theme/About behavior, Loom command entries, owned files/blocks and interrupted pack/shortcut changes.
- Five focused compatibility regressions use unmodified upstream MenuModel/menu bytes pinned to commit 9480d1b6a98156314dbabe6bfef08f39f8b9cd07 with SHA256 provenance and license. They reproduce label-only About action loss and the obsolete themebook picker override.
- The focused check.mjs gate covers pack tests and generated packet consistency; --native adds the installed target report. 112 pack tests pass on macOS and native ARM Linux without weakening preservation assertions.
- Reviewed pack 20261011.16 contains 25 verified members and matches the current runtime. Actual retained .14 upgrade/rollback/return pass on macOS and native ARM Linux with unchanged connection settings and synthetic app/credential data.
- Actual Gum apply/restore flows finish with a passing installed native-parser and ownership report in isolated Linux. No provider inference, real credential lookup, network access or real service restart occurs.
- Fixtures cover pinned upstream 4.0.0.alpha, the version reported by Workstation in the final .43 native checks; Workstation 4.0.4 has previous native evidence. Other Omarchy versions still require native acceptance; no blanket 4.x compatibility or physical keyboard/display/suspend claim is made.
- Actual installed pack 20261012.43 passes all 12 native compatibility checks with zero errors and warnings, including stock Theme/About behavior, installed menu actions, owned files/blocks and interruption state. Actual .43 -> .42 -> .43 rollback/reapplication passed with Iris and the running T3 service preserved. Evidence: /Users/kyle/Developer/artifacts/loom-os/2026-10-12/workbench-desk/native-compatibility-final-43.json, pack-rollback-native-43-to42.json, pack-reapply-native-43.json and native-acceptance-final.json.
- Actual Theme picker selection and About gradient rendering were inspected in both Iris modes during packet #8; desktop PATH, native shell geometry, personal settings, protected branding and original app windows were preserved. Evidence: /Users/kyle/Developer/artifacts/loom-os/2026-10-12/iris-consistency/IMPLEMENTATION-HANDOFF.md and final-verification.json. Packet #1 now also records exact original Office-window reuse through the installed action picker. These native results close the former deployment/connection gap; physical keyboard/display/sleep acceptance remains separate.
