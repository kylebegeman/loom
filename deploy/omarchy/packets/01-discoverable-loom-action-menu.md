# 1. Discoverable Loom action menu

Find and launch existing LoomOS capabilities through the native menu and launcher without remembering commands.

Status: **completed**. Complexity: **Small**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: None.

## Scope

- Searchable native picker with action names, useful descriptions and existing shortcut hints.
- Show missing configuration or installation with a next step; selection never executes an unavailable or arbitrary action.
- Reach the same picker from the launcher, LoomOS menu and CLI; keep Omarchy styling and keyboard cancellation.

## Acceptance

- Search mail, notes/save, AI and connections and reach the correct existing action.
- Opening, filtering, cancellation and missing-action guidance invoke no inference, app writes or secret reads.
- Installed action entry points launch; existing app focus, menu extensions, theme and running service are preserved.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

- Implemented native launcher, LoomOS menu and CLI entry points with searchable descriptions, actual shortcut hints, setup guidance and explicit retry.
- 95 focused integration-pack tests pass, including nine action tests. Focused lint and generated-document consistency checks pass.
- Isolated Linux Gum 2.0.0 checks pass: literal initial queries, filtering/cancellation, unavailable-action guidance and exact synthetic browser dispatch. No inference, app writes or real credential reads.
- Installed reviewed pack 20261011.14 on Workstation. Installed bytes match SHA256 7d1dde40b3c339067132b03ef386b31cb0050070a16d8d157f01e2af8c4fe776. Verified previous pack 20261011.11 remains available; no activation is pending.
- Iris Dark, integration configuration, shell configuration and running t3code.service PID 1154 were preserved through installation.
- Native launcher, actual menu selection, filtering and two-Escape cancellation passed on Workstation. The final entrance-specific check now also passes on installed pack 20261012.43: the Loom actions picker was opened with the literal Open Office query, its exact action was inspected and Enter selected it. The original Office window 0x5bb72788cdb0, PID 238763 was reused; no duplicate window or record write occurred.
- Physical shortcut and laptop sleep/wake acceptance belong to later packets. Original fixture and native menu evidence is retained in the 2026-10-11 packets artifact directory; the completed Office action proof is /Users/kyle/Developer/artifacts/loom-os/2026-10-12/maintenance/packet1-native-proof.json, with native-actions-office.png.
