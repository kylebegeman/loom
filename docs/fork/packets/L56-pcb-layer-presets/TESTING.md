# L56 testing

Focused tests, no repo-wide checks, no sleeps.

## Local verification

Passed 24 focused behavior tests across four files:

| File                                                    | Covers                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/pcb-layer-presets.test.ts` | All five presets on canonical board names, two-layer and four-layer copper expansion, board ordering, opacity, unavailable presets, name lookup and unique ids.                                                                                                                    |
| `apps/web/src/fork/pcb-preview/layers.test.ts`          | Named visibility matching independent of array order, built-in precedence, saved-set labels, custom changes, stale saved-set reconciliation, duplicate name suffixes, strict named editor commands, snapshot identities and preserving inner copper visibility after board reload. |
| `apps/web/src/fork/pcb-preview/LayersTab.test.tsx`      | Apply, hide and show without a write grant; duplicates with unique ids and names; the 20-set limit; disabled writes; applying an older saved set; unavailable presets and missing KiCad layers.                                                                                    |
| `apps/web/src/fork/pcb-preview/LayerSheet.test.tsx`     | Preset visibility changes reuse decoded drawings and Blob URLs; hidden layers do not report canvas errors or enter the accessibility tree.                                                                                                                                         |

Strict lint passed on these tests, their implementation files and `InspectorKit.tsx`. No
browsers, dev servers or repo-wide checks ran. Root integration owns package typechecks and client verification. The editor resolver is
tested directly through its state and failure contracts. Preferences compatibility coverage is shared
with L54 in `preferences.test.ts`.

```sh
./node_modules/.bin/vp test run packages/contracts/src/fork/pcb-layer-presets.test.ts \
  apps/web/src/fork/pcb-preview/layers.test.ts \
  apps/web/src/fork/pcb-preview/LayersTab.test.tsx \
  apps/web/src/fork/pcb-preview/LayerSheet.test.tsx
./node_modules/.bin/vp lint --deny-warnings \
  packages/contracts/src/fork/pcb-layer-presets.ts \
  packages/contracts/src/fork/pcb-layer-presets.test.ts \
  apps/web/src/fork/pcb-preview/layers.ts \
  apps/web/src/fork/pcb-preview/layers.test.ts \
  apps/web/src/fork/pcb-preview/LayersTab.tsx \
  apps/web/src/fork/pcb-preview/LayersTab.test.tsx \
  apps/web/src/fork/pcb-preview/LayerSheet.tsx \
  apps/web/src/fork/pcb-preview/LayerSheet.test.tsx \
  apps/web/src/fork/pcb-preview/InspectorKit.tsx
```

## Manual check

Pending; no client or KiCad visual comparison has been performed.

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

## Integrated verification

The integrating agent completed strict scoped lint and typechecks for contracts,
client-runtime, server and web after wiring all five PCB packets. The focused service
suite passes 31 regressions, including signed PDF limits, canonical output exclusions and
optional project-rule read failures. No repo-wide suite or browser was run.
