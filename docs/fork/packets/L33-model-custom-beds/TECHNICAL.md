# L33 technical design

Cited lines are from `feat/model-bed-picker` at `8676e099e5`.

## Overview

The bed setting gains a list of named beds, a pointer to the active one and a set of hidden
presets. Every reader already goes through the bed list (`listBeds`, `activeBed`, `selectBed` in
`packages/contracts/src/fork/model-beds.ts`, created by the first of L32, L33 or L34; see L32
TECHNICAL.md, "Bed list in contracts"). This packet changes those bodies and adds a few pure
edit helpers next to them. The UI adds entries to the existing menus and a "Beds" area in
settings. Saving goes through the existing `updateSettings` RPC, whose payload becomes a merge
so missing new fields keep their stored values.

## Today

- `BuildPlateSetting` is `{ preset, customMm, pattern }` (`packages/contracts/src/fork/
model-preview-3d.ts:229-238`), with `pattern` decoded to `"grid-mm"` when absent (line 237).
- `preset: "custom"` reads `customMm` (`apps/web/src/fork/model-preview-3d/buildPlate.ts:9-10`);
  its label is "Custom bed" in triggers (`buildPlate.ts:17-18`) and "Custom" in menus
  (`buildPlate.ts:35`).
- The custom size is edited in the Bed menu (`BedPicker.tsx:74-113`, `:166-172`) and in settings
  (`SettingsSection.tsx:217-236`).
- Settings are stored as one JSON row and decoded with the schema
  (`apps/server/src/fork/model-preview-3d/store.ts:13`, `:46-58`), so decoding defaults are the
  only migration needed.
- `updateSettings` replaces the whole object (`ModelPreviewService.ts:973-982`); its payload is
  `ModelPreviewSettings` (`model-preview-3d.ts:390`), and the MCP save tool takes the same shape
  (`apps/server/src/fork/model-preview-3d/mcp.ts:142-150`, `:438-449`). The web always sends the
  full current settings (`BedPicker.tsx:54-57`, `SettingsSection.tsx:78-84`).

## Contracts

In `model-beds.ts` (after the move described in L32):

```ts
const axisMm = Schema.Number.check(Schema.isBetween({ minimum: 10, maximum: 2000 }));
export const CUSTOM_BED_LIMIT = 24;
export const CustomBedId = Schema.String.check(Schema.isPattern(/^custom-[0-9a-f-]{8,36}$/));
export const CustomBed = Schema.Struct({
  id: CustomBedId,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60)),
  /** Width, depth and height in mm; a null height is a flat surface. */
  volumeMm: Schema.Tuple([axisMm, axisMm, Schema.NullOr(axisMm)]),
});
const presetIds = Object.keys(BUILD_PLATE_PRESETS) as (keyof typeof BUILD_PLATE_PRESETS)[];
const PresetOnlyId = Schema.Literals(presetIds);
const customBeds = Schema.Array(CustomBed).check(
  Schema.isMaxLength(CUSTOM_BED_LIMIT),
  Schema.makeFilter((beds) => new Set(beds.map((b) => b.id)).size === beds.length, {
    message: "Custom bed ids must be unique.",
  }),
);
const hiddenPresets = Schema.Array(PresetOnlyId).check(Schema.isMaxLength(64));

export const BuildPlateSetting = Schema.Struct({
  preset: BuildPlatePresetId,           // unchanged: a preset id or "custom"
  /** The unsaved "Custom size", used when preset is "custom" and customBedId is null. */
  customMm: ...,                        // unchanged
  pattern: ...,                         // unchanged
  /** With preset "custom", the named bed in use; null for "Custom size". */
  customBedId: Schema.NullOr(CustomBedId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  customBeds: customBeds.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  hiddenPresets: hiddenPresets.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});

/** What clients and agents send. New fields may be left out; the server keeps stored values. */
export const BuildPlateSettingUpdate = Schema.Struct({
  preset: BuildPlatePresetId,
  customMm: BuildPlateSetting.fields.customMm,
  pattern: Schema.optionalKey(BuildPlatePattern),
  customBedId: Schema.optionalKey(Schema.NullOr(CustomBedId)),
  customBeds: Schema.optionalKey(customBeds),
  hiddenPresets: Schema.optionalKey(hiddenPresets),
});
```

Why a named bed is selected with `preset: "custom"` plus `customBedId`, not a new `preset` value:
`preset` is a literal union, so an older Loom server would reject a payload naming a custom id
and the save would fail. A separate field is dropped silently by an older server (Effect Schema
strips unknown keys by default, `.repos/effect-smol/packages/effect/src/SchemaAST.ts:463`), so the
worst case there is falling back to "Custom size".

In `model-preview-3d.ts`:

```ts
export const ModelPreviewSettingsUpdate = Schema.Struct({
  ...ModelPreviewSettings.fields,
  buildPlate: BuildPlateSettingUpdate,
});
```

and the `updateSettings` RPC payload (`model-preview-3d.ts:390`) becomes
`ModelPreviewSettingsUpdate`. Its success stays `ModelPreviewSettings`. Every current full payload
still decodes, so this is compatible in both directions. Packets that add top-level settings
fields later (L40 `displayUnits`) add them to `ModelPreviewSettingsUpdate` as `optionalKey` too.

`DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate` gains `customBedId: null, customBeds: [],
hiddenPresets: []`.

### Bed list and edit helpers

All in `model-beds.ts`, pure, shared by web, server and tests:

| Helper                                  | Behavior                                                                                                                                                                                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listBeds(setting, { includeHidden? })` | Visible presets in table order (a hidden preset is included when it is active or `includeHidden`), then each custom bed as `{ id, label: name, kind: "custom", volumeMm, note: null }`, then `{ id: "custom", label: "Custom size", kind: "custom", volumeMm: customMm }`. |
| `activeBed(setting)`                    | The preset; or, for `preset: "custom"`, the named bed with `customBedId`, falling back to "Custom size" when the id is null or missing.                                                                                                                                    |
| `selectBed(setting, id)`                | A preset id sets `preset` and clears `customBedId`; a custom bed id sets `preset: "custom"` and `customBedId`; `"custom"` selects "Custom size". Unknown ids leave the setting unchanged.                                                                                  |
| `addCustomBed(setting, bed)`            | Appends and selects it. Refuses (returns the setting unchanged) at the limit or on a duplicate id.                                                                                                                                                                         |
| `updateCustomBed(setting, id, patch)`   | Replaces `name` and/or `volumeMm`.                                                                                                                                                                                                                                         |
| `removeCustomBed(setting, id)`          | Removes it; if it was active, selects `DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate.preset` with `customBedId: null`.                                                                                                                                                         |
| `setPresetHidden(setting, id, hidden)`  | Adds or removes the id; refuses to hide the active preset.                                                                                                                                                                                                                 |
| `newCustomBedId()`                      | `"custom-" + crypto.randomUUID()`. Web and Node both have `crypto.randomUUID`.                                                                                                                                                                                             |

`buildPlateLabel` in `buildPlate.ts` becomes `activeBed(setting).label`, which now reads "Custom
size" for the slot. `bedGroups(setting)` groups `listBeds(setting)`; Manage beds calls
`listBeds(setting, { includeHidden: true })`.

Name rules (trimmed, 1 to 60 characters, no case-insensitive duplicate among custom beds) are
checked in the UI with a small `customBedNameError(setting, name, exceptId?)` helper. The schema
enforces only length, so a duplicate saved by an agent still loads.

## Server

- `ModelPreviewService.updateSettings` (`ModelPreviewService.ts:973-982`) takes
  `ModelPreviewSettingsUpdate` and saves
  `{ ...input, buildPlate: { ...settings.buildPlate, ...input.buildPlate } }`, where `settings`
  is the current in-memory value. Missing optional keys are absent from the decoded input, so the
  spread keeps stored values.
- The RPC handler (`rpc.ts:51-52`) is unchanged apart from its inferred input type.
- `loom_model_preview_3d_save_settings` takes `{ settings: W.ModelPreviewSettingsUpdate }`
  (`mcp.ts:142-150`). Its description becomes: "Update 3D preview settings: build plate, named
  custom beds, hidden presets and OpenSCAD options. Leave out customBeds or hiddenPresets to keep
  them." `loom_model_preview_3d_settings` already returns the full settings, so agents can read
  the beds.
- No new table or migration: the settings row is JSON and decoding defaults fill the new fields
  (`store.ts:46-52`).

## Clients

### Bed menu (`BedPicker.tsx`)

- Custom group: named beds, then "Custom size" (from `bedGroups`).
- When "Custom size" is active: the size fields as today, plus "Save as bed" (a small button).
  It turns into an inline name `Input` with Enter to save and Escape to cancel; on save,
  `save(addCustomBed(plate, { id: newCustomBedId(), name, volumeMm: plate.customMm }))`.
  Disabled at the limit with the limit text.
- When a named bed is active: the same `CustomSize` fields bound to that bed's volume, committing
  `updateCustomBed`. For a bed with no height limit, the height field shows "No limit" and is
  read-only here (change it in settings).
- After the pattern control, a link "Manage beds" (`<Link to="/settings/loom" />`, as
  `ModelInspector.tsx:326` does).
- `samePlate` (`BedPicker.tsx:35-38`) compares the new fields too (ids, names and volumes),
  so the pending state clears correctly.

### Part's printer menu (`ModelInspector.tsx:275-333`)

Uses `bedGroups(plate)` and `selectBed`; the radio value is the bed id. The bottom item becomes
"Manage beds and preview settings".

### Settings (`SettingsSection.tsx`)

Replace the custom size block (`SettingsSection.tsx:217-243`) with a new component
`ManageBeds.tsx` rendered after the Bed row. It edits the form's local `settings.buildPlate` via
`set("buildPlate", ...)`, so changes save with "Save settings" like the rest of the form:

- "Custom size" fields when the slot is active (as today).
- "Custom beds": one row per bed with a name `Input`, width, depth and height inputs, a "No height
  limit" checkbox, and a delete button (`Button variant="ghost-muted" size="icon-sm"`, label
  "Delete <name>"). "Add custom bed" appends `{ name: "Custom bed N", volumeMm: customMm }`.
  Empty state "No custom beds yet."
- "Show in menus": the presets from `listBeds(setting, { includeHidden: true })`, grouped
  Printers and Surfaces, each with a `Switch`. The active preset's switch is disabled with the
  description "In use".

Delete in settings removes the row from the local form state; the reverse is leaving without
saving, or re-adding. Delete of the active bed applies `removeCustomBed` so the Bed row shows
the new choice before saving. No Undo toast: nothing is saved until "Save settings", and the Bed
menu has no delete.

`validateSettings` (`SettingsSection.tsx:35`) already decodes the whole form with
`ModelPreviewSettings`, so the bed count, id and size limits are checked on save with no extra
code. Name rules come from `customBedNameError` and show on the row's field; "Save settings" is
disabled while any row has a name error.

### Pending saves

`useBuildPlate` (`BedPicker.tsx:44-69`) sends `{ ...settings, buildPlate: next }`. With the
merge payload that stays correct. No change to its shape.

### Mobile

None.

## Agent-facing tools

`loom_model_preview_3d_settings` (read) and `loom_model_preview_3d_save_settings` (merge update)
cover listing, adding, renaming, resizing, deleting and hiding. No new tool: beds are settings,
and one save is atomic.

## Version skew

| Client      | Server      | Result                                                                                                                                                                                                                   |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| With L33    | With L33    | Full behavior.                                                                                                                                                                                                           |
| Without L33 | With L33    | Old client never sees named beds (it strips unknown keys). Its saves omit the new keys, which the merge keeps. If a named bed is active, the old client shows "Custom bed" with `customMm`, which is wrong but harmless. |
| With L33    | Without L33 | The old server strips the new keys. Named beds do not persist, and the menus show only presets and Custom size after the save round trip. Acceptable: Loom client and server normally ship together.                     |

## Performance

Settings grow by at most 24 small records (under 3 KB). Menus render at most 38 items. No viewer
or subscription change.

## Alternatives considered

- **Migrate `customMm` into a named "Custom" entry.** Needs a decode-time transformation, changes
  what older clients see, and loses the quick scratch size. Rejected in favour of keeping the slot.
- **Encode named beds into `preset` (`"custom:<id>"`).** Breaks older servers' decoding of every
  save. Rejected.
- **Store beds in their own table with RPCs.** More surface for no gain at 24 records; L51 is the
  point where printers become their own data.
- **Client-local hidden presets.** Hiding is about which printers the environment's owner has,
  and agents should see the same list, so it belongs with the server setting.
