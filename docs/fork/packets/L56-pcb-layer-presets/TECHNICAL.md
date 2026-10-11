# L56 technical design

Cited lines are from `docs/model-preview-follow-ups` at `8676e099e5`.

## Overview

Built-ins are constant data plus one pure resolver. Applying a preset produces the same
`PcbLayerState[]` the Layers tab already applies for saved sets (`LayersTab.tsx:236`), so the
render path, Solo, opacity and saving are unchanged. Matching uses `sameVisibility` in
`apps/web/src/fork/pcb-preview/layers.ts`, comparing layer identities, visibility and opacity
independently of array order. The only persisted additions are a per-device list of hidden ids and,
on demand, an ordinary saved set.

## Contracts

New file `packages/contracts/src/fork/pcb-layer-presets.ts`, re-exported from
`packages/contracts/src/fork/index.ts`:

```ts
import type { PcbLayerState } from "./pcb-workspace.ts";

/** "copper" stands for F.Cu, B.Cu and every In<n>.Cu on the board. */
type PresetLayer = "copper" | `${"F" | "B"}.${string}` | "Edge.Cuts";
export const PCB_LAYER_PRESETS = [
  {
    id: "assembly-front",
    name: "Assembly front",
    layers: ["F.Fab", "F.Silkscreen", "F.Courtyard", "Edge.Cuts"],
  },
  {
    id: "assembly-back",
    name: "Assembly back",
    layers: ["B.Fab", "B.Silkscreen", "B.Courtyard", "Edge.Cuts"],
  },
  { id: "copper-only", name: "Copper only", layers: ["copper"] },
  {
    id: "fab-review",
    name: "Fab review",
    layers: ["copper", "F.Mask", "B.Mask", "F.Paste", "B.Paste", "Edge.Cuts"],
  },
  {
    id: "silkscreen-check",
    name: "Silkscreen check",
    layers: ["F.Silkscreen", "B.Silkscreen", "F.Mask", "B.Mask", "Edge.Cuts"],
  },
] as const satisfies readonly { id: string; name: string; layers: readonly PresetLayer[] }[];
export type PcbLayerPresetId = (typeof PCB_LAYER_PRESETS)[number]["id"];
export type PcbBuiltInLayerPreset = (typeof PCB_LAYER_PRESETS)[number];

/** Visible states for every board layer, in board order; null when the board has none of
 * the preset's layers other than Edge.Cuts. */
export function resolveLayerPreset(
  preset: PcbBuiltInLayerPreset,
  boardLayers: readonly string[],
): PcbLayerState[] | null;
/** By id, then by name, case-insensitive. */
export function findLayerPreset(idOrName: string): PcbBuiltInLayerPreset | undefined;
```

Names are canonical, matching what the server emits after `canonicalLayer`
(`apps/server/src/fork/pcb-preview/semantics.ts:461-475`): `F.SilkS` becomes `F.Silkscreen`,
`F.CrtYd` becomes `F.Courtyard`. `F.Fab`, `F.Mask`, `F.Paste` and `Edge.Cuts` are already
canonical. "copper" matches `/^(F|B|In\d+)\.Cu$/`, the same test as `reconcileLayers`
(`apps/web/src/fork/pcb-preview/usePcbPreview.logic.ts:48`).

`PcbEditorResult.state` (`packages/contracts/src/fork/pcb-workspace.ts:362-378`) gains:

```ts
/** Built-in preset id or saved set name the visible layers match, when they match one. */
layerPreset: Schema.optional(Schema.String),
```

Optional, so an older server or client simply omits it. `PcbEditorAction` needs no change: its
`name` field (`pcb-workspace.ts:343`) already exists for `load-view`.

## Server

No service code. The `loom_pcb_editor` description (`apps/server/src/fork/pcb-preview/mcp.ts:
25-27`) appends: "layers accepts name: a built-in preset id (assembly-front, assembly-back,
copper-only, fab-review, silkscreen-check) or a saved layer set name." The server forwards
editor commands to the connected panel as today.

## Storage

- Hidden ids: `hiddenLayerPresets: Schema.Array(Schema.String)` with
  `Schema.withDecodingDefault(Effect.succeed([]))` in
  `apps/web/src/fork/pcb-preview/preferences.ts` (schema at `:11-15`), plus
  `setHiddenLayerPresets(ids)`. Unknown ids are kept and ignored, so a future preset rename
  cannot crash decoding. The rest of the schema needs decoding defaults first, because on
  `main` a new required field would reset trusted designs on decode failure
  (`preferences.ts:22-30`). Commit `6ddf84c1aa` (local `fix/preview-defects`) adds them; if it
  is not on your base, whichever of L54 and L56 lands first does it (L54 TECHNICAL.md, Storage).
- Duplicates are ordinary `layerSets` entries in the design workspace
  (`pcb-workspace.ts:120-128`, max 20), written with the existing `mutate`.
- No new `PcbWorkspace` field. That struct (`pcb-workspace.ts:120-128`) has no decoding
  defaults today, so a packet that adds a workspace field must give it one; this packet only
  appends to the existing `layerSets` array and is unaffected.

## Clients

### Layers tab (`apps/web/src/fork/pcb-preview/LayersTab.tsx`)

Add a `Section` titled "Presets" immediately before "Saved sets" (`:228`):

- `count`: visible built-ins, as "3 of 5" when any are hidden.
- `action`: a `Menu` with an icon trigger labelled "Preset options". Group "Duplicate as saved
  set" lists each resolvable built-in; group "Hidden" lists hidden ones as "Show <name>".
- Body: one `Chip` per visible built-in. `pressed` when
  `sameVisibility(layers, resolveLayerPreset(p, names))`; `onClick` applies it through the
  existing `set()` (`:95-98`), which clears Solo; `onRemove` hides it with
  `removeLabel="Hide <name>"`; `applyDisabled` with a shared tooltip hint when
  `resolveLayerPreset` returns null. Hiding remains available for an unavailable preset.
- Duplicate: `mutate((d) => ({ ...d, layerSets: [...d.layerSets, { id: randomUUID(), name,
layers: resolved }] }))` through the tab's `write` helper, as "Save set" does (`:100-107`).
  `name` is the preset name, or "<name> 2", "<name> 3" when taken. Disabled when `!canSave`,
  when 20 sets exist, or while writing.
- The "Custom" badge (`:125-129`) also hides when a built-in or saved set matches.

Saved set chips apply `reconcileSaved(s.layers, names)` from `layers.ts`. Removed layers are
dropped and new layers start hidden, preserving existing opacities. `matchLayerSet` names the
active built-in first, otherwise the matching saved set. Read-only clients can apply either;
only duplicating, saving and removing require workspace write permission.

### Drawing layer menu and labels (`PcbPreviewPanel.tsx`)

- Menu (`:894-911`): after the "Copper" group add a `MenuGroup` "Presets" with the visible
  built-ins, a check on the matched one, calling `applyLayers(resolved)`, a small helper that
  sets `customLayers` the same way `LayersTab` does through `onLayers`.
- One memoized `activeLayerSet` = matched built-in name, else matched saved set name, else
  null, computed from `customLayers`, `workbench.inspection.layers` and
  `workbench.data.layerSets`.
- Shelf label (`:888-892`): `activeLayerSet ?? "<n> layers"` when custom layers are active.
- Status bar (`:1334-1342`): for KiCad boards, `activeLayerSet` when set, else
  `"<n> layers"` when custom layers are active, else `PRESET_LABELS[layers]` as today.

### Editor command (`PcbPreviewPanel.tsx:492-496`)

```ts
case "layers": {
  if (c.layers && c.name) throw new Error("Pass layers or name, not both.");
  if (c.name) {
    const names = workbench.inspection?.layers ?? [];
    const builtIn = findLayerPreset(c.name);
    const saved = workbench.data.layerSets.find((s) => s.id === c.name || s.name === c.name);
    const next = builtIn ? resolveLayerPreset(builtIn, names)
      : saved ? reconcileSaved(saved.layers, names) : undefined;
    if (next === undefined) throw new Error("Unknown layer preset.");
    if (next === null) throw new Error("This board has none of the preset's layers.");
    setCustomLayers(next);
    break;
  }
  // existing behaviour for c.layers
}
```

Hidden built-ins still resolve: hiding is display only. The snapshot (`:545-569`) adds
`layerPreset: activeLayerSet ?? undefined` (built-in id rather than name for built-ins, so an
agent can round-trip it).

## Agent-facing tools

- `loom_pcb_editor` `layers` with `name`, for example:

  ```sh
  t3 pcb editor '{"designId":"hw/main.kicad_pro",
    "command":{"action":"layers","name":"fab-review"}}'
  ```

- The snapshot reports `layerPreset`.
- No new MCP tool: presets are a visible editor state, which is exactly what the editor
  command is for. Server-side renders already accept `layerNames`
  (`packages/contracts/src/fork/pcb-preview.ts:93-100`); an agent that wants a preset's layers
  in a headless render resolves them from the ids in the description, or later packets (L57,
  L65) do it on the server with `resolveLayerPreset`.

## Performance

Applying a preset only flips `visible`; every layer drawing is already loaded because the
render request lists all custom layer names (`PcbPreviewPanel.tsx:162-165`), so there is no new
render and no network traffic. Matching runs five comparisons over at most 64 layers per
render. No animation.

## Alternatives considered

- Built-ins as seeded saved sets in each design workspace. Rejected: they would be editable,
  count against the 20-set limit, and diverge between designs.
- Adding presets to the `PcbLayerPreset` literal (`pcb-preview.ts:67`). Rejected: that literal
  drives the server render base and remembered selections; widening it touches the render
  contract for a client-side view choice.
- Hidden ids in the design workspace. Rejected: hiding is a personal preference and would need
  a write grant.
