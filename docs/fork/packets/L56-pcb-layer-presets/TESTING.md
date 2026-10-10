# L56 testing

Focused tests, no repo-wide checks, no sleeps.

## Automated tests

| File                                                                         | Covers                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/pcb-layer-presets.test.ts` (new)                | Every preset's non-copper names are canonical (none of `F.SilkS`, `F.CrtYd`, `Dwgs.User`); `resolveLayerPreset` keeps board order, hides everything else, sets opacity 1, expands "copper" to F.Cu, In1.Cu, In2.Cu, B.Cu, skips missing layers, returns null when only Edge.Cuts would show; `findLayerPreset` by id, by name in any case, unknown is undefined; ids are unique. |
| `apps/web/src/fork/pcb-preview/usePcbPreview.logic.test.ts` (update)         | `matchLayerSet` prefers a built-in, then a saved set, then null after one eye toggle; `reconcileSaved` drops removed layers, adds new ones hidden, keeps opacity.                                                                                                                                                                                                                |
| `apps/web/src/fork/pcb-preview/preferences.test.ts` (new or update from L54) | A stored value without `hiddenLayerPresets` keeps `trusted`; hide then show round trips; an unknown id survives decode.                                                                                                                                                                                                                                                          |
| `apps/web/src/fork/pcb-preview/workspace.interactions.test.tsx` (update)     | One interaction: the editor `layers` command with `name: "assembly-front"` sets the expected visible layers and the snapshot reports `layerPreset`; an unknown name rejects with "Unknown layer preset."                                                                                                                                                                         |

No markup snapshots for the chips or menus.

## Commands

```sh
vp test run packages/contracts/src/fork/pcb-layer-presets.test.ts \
  apps/web/src/fork/pcb-preview/usePcbPreview.logic.test.ts \
  apps/web/src/fork/pcb-preview/preferences.test.ts \
  apps/web/src/fork/pcb-preview/workspace.interactions.test.tsx
vp lint packages/contracts/src/fork apps/web/src/fork/pcb-preview \
  apps/server/src/fork/pcb-preview/mcp.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`:

1. Open a KiCad board with inner layers. Layers, Presets: apply each; compare with KiCad's own
   layer view.
2. Apply "Assembly front" from the drawing's layer menu: shelf and status bar say "Assembly
   front"; the Layers chip is pressed.
3. Toggle one eye: "Custom". Apply a saved set: the status bar shows its name.
4. Hide two presets, reload: still hidden; show one from "Preset options".
5. Duplicate "Fab review": a saved set appears; change its opacity; the built-in is unchanged.
6. From a connection without the write grant: Duplicate disabled, apply and hide still work.
7. Ask an agent to show the silkscreen check, then take a snapshot: `layerPreset` matches.
8. Open a tscircuit board: no Presets section.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge check in SEAMS.md; expect no conflicts. After
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
