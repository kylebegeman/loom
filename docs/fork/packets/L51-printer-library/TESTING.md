# L51 testing

Focused checks only. No repository-wide checks or browser/computer-use runs.

## Verification evidence (2026-10-10)

Core milestone: `3e5c894a44`. Shared viewer and service wiring is in the final integration milestone.

79 focused tests across seven files passed for library/schema validation, profile parsing, migration, persistence, optimistic conflicts, preset compatibility and round-bed geometry. Shared service regressions also cover library/material persistence across restart. Installed-profile inheritance resolves through the shared slicer profile reader. Legacy customBeds and hiddenPresets remain accepted for older clients; after migration the versioned library is authoritative for the new UI.

The integrated MCP tests cover tool availability, disabled-agent gating, caller paths,
restore conflicts and undo, assembly operations, STEP output and Python execution grants.
RPC regressions verify that indirect Python execution cannot bypass terminal permission.
Targeted strict lint and affected package typechecks cover the shared integration.
Browser, desktop/GPU and remote-client interaction checks remain unverified.

## Focused commands

```sh
./node_modules/.bin/vp test run packages/contracts/src/fork/model-printers.test.ts \
  packages/contracts/src/fork/model-beds.test.ts \
  apps/server/src/fork/model-preview-3d/printerProfiles.test.ts \
  apps/server/src/fork/model-preview-3d/printers.test.ts \
  apps/server/src/fork/model-preview-3d/store.test.ts \
  apps/web/src/fork/model-preview-3d/buildPlate.test.ts \
  apps/web/src/fork/model-preview-3d/viewer/bed.test.ts \
  apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts \
  apps/server/src/fork/model-preview-3d/mcp.test.ts \
  apps/server/src/fork/model-preview-3d/rpc.test.ts
```

The affected package typechecks are `@t3tools/contracts`, `@t3tools/client-runtime`,
`@t3tools/web` and `t3`. Run lint only on changed files, with `--deny-warnings`.

## Manual check

With Kyle's permission, on the worktree dev server seeded from real data:

1. Open Loom settings, 3D models. Built-ins, any migrated custom beds and the starter materials
   are listed; the active bed is unchanged from before the upgrade.
2. Import `/Applications/BambuStudio.app/Contents/Resources/profiles/BBL/machine/Bambu Lab
H2D 0.4 nozzle.json`. Review shows 350 × 320 × 325 and two zones; save it; pick it in the
   Bed menu; with L34 landed, the zones draw as on the built-in H2D.
3. Duplicate the built-in Prusa MK4S, change the nozzle to 0.6, save, select it.
4. Add a round 200 mm delta surface; the viewport plate is a circle.
5. Set a price on PLA. With L47 landed, a slice estimate shows a cost.
6. Open settings in a second browser, edit there, then save in the first: the conflict
   message appears.
7. Delete the active printer: the bed falls back to the H2D on both clients; "Undo" restores it.
8. Export the library, delete two entries, import the file: they come back with the same ids.
9. Over a remote connection (Tailscale or T3 Connect), import a profile from the browser's
   machine.
10. Ask an agent to "add a 300 mm Voron with a 0.4 nozzle" and select it.
11. Against an upstream T3 server: no 3D settings appear.

## Merge safety

No upstream file changes, so the merge preview in [SEAMS.md](./SEAMS.md) must exit 0. After
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
