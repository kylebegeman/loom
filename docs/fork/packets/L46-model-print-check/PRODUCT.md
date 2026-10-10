# L46 product

## Problem

Today Loom says whether a part fits the bed and, for SCAD only, whether OpenSCAD called the
result "simple" (`ModelInspector.tsx:370`, `ModelInspector.tsx:427-436`). Everything else that
fails a print is found in the slicer or on the printer: an open mesh, a pin thinner than the
nozzle, a wall the slicer silently drops, a feature that starts in mid-air, a tall part standing
on a sliver. Agents have it worse: they iterate on SCAD with no critic at all. Kyle wants one
report that both he and the agent read, with numbers and locations, before anything reaches a
slicer.

## What the user can do

- Open the Part tab and see "Print check" with a verdict: "Ready to print", "Check before
  printing" or "Will not print as is".
- Read one row per check (mesh, shells, bed fit, first layer, overhangs, islands, walls, small
  features) with a pass, info, warning or failure state and a measured value, for example
  "Thinnest wall 0.55 mm (needs 0.80 mm)".
- Expand a row to see its located findings. Click one to frame the camera on it; the pin for
  that finding is highlighted.
- See the findings as numbered pins on the model, listed under "Print check" in Markup, and hide
  them with "Print check pins" in the display menu or "Hide pins" in Markup.
- Change the nozzle diameter, overhang angle and first-layer height in **Settings > Loom > 3D
  model**. With a printer library (L51) the nozzle follows the active printer.
- Run the check again after an edit. While the Part tab is open the check reruns by itself when
  the geometry, orientation or check settings change; "Check again" forces it.
- Capture a view with the pins included, so the agent sees the same marks.
- Ask an agent to check a part. It calls `loom_model_preview_3d_check` and gets the same report,
  with coordinates it can act on, whether or not the panel is open.

## Entry points

| Way in                                                                                | Way out                                                                                                   | How the state is visible                                                    |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Part tab opens: the check runs for the current geometry if no fresh report is cached. | "Cancel", or a newer edit, which supersedes it. A check shared with an agent keeps running for the agent. | "Checking..." with elapsed time in the section header.                      |
| "Check again" in the section header.                                                  | "Cancel" while running.                                                                                   | The header shows the time of the last run and "Cached" when reused.         |
| Click a finding row in Part or Markup.                                                | Click it again or press Escape.                                                                           | Highlighted pin and row.                                                    |
| "Print check pins" in the display menu, or "Show pins" in Markup.                     | The same toggle, or "Hide pins".                                                                          | Checkbox state; pins drawn or not.                                          |
| The Part tab badge (warning tone) when the verdict is a warning or failure.           | Fixing the model; the badge follows the newest report.                                                    | Badge on the Part tab, as for oversized parts today (`ModelPanel.tsx:704`). |
| Settings fields for nozzle, overhang angle and first layer.                           | Edit back; defaults are 0.4 mm, 45 degrees and 0.2 mm.                                                    | The values in settings; the report header shows the values it used.         |
| `loom_model_preview_3d_check` for agents.                                             | The agent tool switch in settings.                                                                        | The tool returns the report; the panel shows its own (shared cache).        |

There is no new keyboard shortcut. The check is a report, not a mode, and every key a packet
might want is allocated in MODEL-3D-FOLLOW-UPS.md.

## States

- Loading: "Checking..." with elapsed seconds. Previous findings stay visible, marked stale,
  until the new report arrives.
- Empty: before the model loads, the section shows "The print check runs when the model loads."
  A model with no triangles reports the failure "This file has no printable geometry."
- Error: the server message with "Try again", for example "This glTF uses Draco compression.
  Export an uncompressed model." or "Too many triangles to check (4,812,330). The limit is
  3,000,000." A timeout reads "The print check took longer than 60 seconds and was stopped."
- Incomplete: a stage that hit its time budget is marked "Partly checked" with the sample
  count it reached; the verdict says "Check before printing" at best.
- Stale: when the geometry revision, orientation or check settings differ from the report's,
  rows dim and the header reads "Model changed. Checking..." (Part open) or "Out of date"
  (Markup only, Part closed).
- Disabled: STEP files show "Print checks need a mesh. STEP files belong in the Fabrication
  app." SCAD without OpenSCAD shows the existing install guidance. The single-file executable
  shows "Print checks are not available in this build." Environments without the feature never
  show the panel (L23).
- Agent tool disabled: the tool fails with "Agent model tools are disabled in Loom settings.",
  as its siblings do (`apps/server/src/fork/model-preview-3d/mcp.ts:271-276`).

## Surfaces and connection modes

Web and desktop. Mobile has no 3D panel. The check runs on the environment host, so a phone
browser or a remote desktop client gets the same report as a local one; only the report crosses
the connection. On an upstream T3 server the panel is unavailable (L23).

## Decisions

- The server checks the geometry, not the browser: agents need the report without a panel, and
  a remote client should not download and analyse a 150 MB mesh to show a list.
- The check runs in a worker thread with a hard 60 second timeout: geometry work must never
  block the event loop that serves every client.
- Severity has three levels. "Fail" means the slicer will drop or cannot place geometry (part
  larger than the bed, features below the nozzle, no first-layer contact, empty file).
  Everything a slicer can usually cope with (supports, small holes, loose shells) is a warning or
  information.
- Thin walls are measured by sampling, not exhaustively: 20,000 area-weighted rays give a stable
  answer in well under a second on typical parts. The sampler is seeded from the geometry
  revision, so the same file always gives the same report.
- The default overhang angle is 45 degrees from vertical: the usual rule of thumb, and the value
  L36 uses. Cura measures the same way (0 supports everything, 90 nothing) but its base profile
  defaults to 50, so 45 errs toward warning.
- Pins are display only. Findings are recomputed, not saved to the workspace; the cache makes
  revisits instant.
- No free-form automatic fixing and no "auto-orient" here: L35 orients and the agent edits.
- glTF and GLB are checked. PCB references from `loom_pcb_export_reference` are GLB, and
  enclosure work needs them.

## Decisions needed from Kyle

1. Worker bundling. The worker needs its own bundled script, which means one marked edit to the
   upstream `apps/server/vite.config.ts` pack entry list (see SEAMS.md). Recommendation: accept
   the seam. It mirrors upstream's own `claude-history-worker.ts` entry on the same line.
2. The single-file `t3` executable (`T3CODE_PACK_EXE=1`) embeds only `src/bin.ts`
   (`apps/server/vite.config.ts:81`), so it has no worker script. Recommendation: show "Print
   checks are not available in this build." there for v1. npm installs, `npx t3` and the
   desktop app all ship the worker. Embedding it as an executable asset can follow if needed.
