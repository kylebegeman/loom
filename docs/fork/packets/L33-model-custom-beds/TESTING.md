# L33 testing

Focused tests, no repo-wide checks, no sleeps.

## Verification evidence (2026-10-10)

Implementation milestones: `331537b175` (contracts and host services), `90db501feb` (viewer and inspector integration).

On `feat/model-orientation-sections-print-check`, 69 focused tests passed across five files covering bed contracts,
settings updates, menu helpers and service persistence. Contracts, client-runtime, web and server package typechecks passed.
Targeted lint passed for the checked files, including the ten root integration files. Browser, desktop, GPU, relay and real-model
performance checks were not run. No repository-wide checks were run.

## Automated tests

| File                                                                         | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/model-beds.test.ts` (new or update)             | Decoding settings without the new fields gives `customBedId: null`, `customBeds: []`, `hiddenPresets: []`. Decoding rejects 25 beds, duplicate ids, a size outside 10 to 2000 mm, an empty or 61-character name, an unknown hidden preset and `"custom"` in `hiddenPresets`. A null height decodes. `listBeds`: hidden presets left out, the active hidden preset kept, `includeHidden` lists all, named beds in insertion order, "Custom size" last. `activeBed`: named bed, missing id falls back to "Custom size". `selectBed`: preset clears `customBedId`, named bed sets both, unknown id is a no-op. `addCustomBed` selects and refuses at the limit. `removeCustomBed` of the active bed selects the default preset; of another bed keeps the selection. `setPresetHidden` refuses the active preset. `customBedNameError`: blank, too long, case-insensitive duplicate, own name allowed when renaming. |
| `packages/contracts/src/fork/model-preview-3d.test.ts` (new)                 | `ModelPreviewSettingsUpdate` accepts the old full shape and a payload with the new fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/web/src/fork/model-preview-3d/buildPlate.test.ts` (update)             | `buildPlateLabel` says "Custom size" for the slot and the name for a named bed; `bedGroups` puts named beds before "Custom size" and leaves hidden presets out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts` (update) | `updateSettings` with an update lacking `customBeds` and `hiddenPresets` keeps the stored ones; with them, replaces them; the saved value round-trips through `getSettings` after a new service instance on the same store.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/server/src/fork/model-preview-3d/store.test.ts` (update)               | A row written in the old JSON shape decodes with the new defaults.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/server/src/fork/model-preview-3d/mcp.test.ts` (update)                 | The save tool accepts the old settings shape and passes it to `updateSettings` unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

No component markup tests: the menus and settings rows render tested helpers.

## Commands

```sh
vp test run packages/contracts/src/fork/model-beds.test.ts \
  packages/contracts/src/fork/model-preview-3d.test.ts \
  apps/web/src/fork/model-preview-3d/buildPlate.test.ts \
  apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts \
  apps/server/src/fork/model-preview-3d/store.test.ts \
  apps/server/src/fork/model-preview-3d/mcp.test.ts
vp lint packages/contracts/src/fork apps/web/src/fork/model-preview-3d \
  apps/server/src/fork/model-preview-3d
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db` and a copied `settings.json` only if needed:

1. Open a model. Bed menu, "Custom size", set 400 x 300 x 0 is refused; set 400 x 300 x 200,
   "Save as bed", name "Laser", Enter. "Laser" is selected and listed under Custom.
2. Pick the H2D, then "Laser" again from Part's printer menu. The plate follows.
3. Reload, and open the panel from a second browser on the same environment: "Laser" is there.
4. Settings, Beds: rename "Laser", untick a height, add a second bed, hide the Prusa printers.
   "Save settings". The menus match. The H2D switch is disabled while it is the active bed.
5. Delete the active named bed in settings; the Bed row shows the H2D. Leave without saving and
   come back: the bed is still there. Delete again and save.
6. From a connection without settings permission: menus read-only, settings controls disabled.
7. Ask an agent to add a bed named "Desk mat", 600 x 400 with no height, and select it. Then ask
   it to save only `openscadPath` using the settings shape it read before: the beds remain.
8. Light and dark themes; narrow panel (sheet) and narrow settings width.

Upstream server: the panel and settings section are unavailable, nothing to check.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge check in SEAMS.md; expect no conflicts. After
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
