# L57 technical design

`PcbPreviewService.print` is the shared entry point for the PCB dialog, `loom_pcb_print`
and `t3 pcb print`. It uses `makeTrueScalePrint` from
`apps/server/src/fork/pcb-preview/trueScalePrint.ts`. The factory captures the host filesystem
and path services during construction; the existing service callbacks resolve workspaces,
source snapshots, tools, signed files and safe destination folders. The service's `run`
callback already serializes KiCad subprocesses, so the print helper must not acquire the
same tool semaphore again.

## Wire and permission boundaries

`packages/contracts/src/fork/pcb-print.ts` holds `PcbPrintInput` and `PcbPrintResult`.
Inputs default to top, the board's paper, black and white, and no workspace save. A missing
mirror flag mirrors the bottom. `layers` accepts up to 64 canonical names or an L56 preset
id/name. Empty layer arrays use the side defaults. Missing layers are skipped with a warning;
a choice with no printable layers fails. Presets resolve against the actual board table.

`loom.pcb-preview.print` requires terminal operation permission. Client availability uses
the command's permission atom. The client also requires trust before executing tscircuit
source. MCP acts as the caller, enforces source execution permissions and defaults `save`
to true. The CLI reaches the same MCP handler. No new keybinding or mobile UI is added.

## Export and cache

1. Resolve the design, check that KiCad designs have a board, require KiCad 9 or newer,
   and obtain the source snapshot.
2. Look up a cache key from workspace, design, source hash, print options and KiCad version.
   A cache hit must have a bounded, schema-valid print manifest and a regular PDF within
   its size limit. Signed URLs and host paths are not persisted in the print manifest.
3. Prepare a scoped `pending-print-` directory under the PCB cache. KiCad designs copy
   the board and adjacent project. tscircuit designs run `tsci export -f kicad_pcb` in the
   existing isolated circuit staging directory, with the existing restricted environment.
4. Change the top-level paper form only in the copied board. Offset-based replacement
   preserves every other source byte; `board` is a no-op. Source and project files are never
   written. Generate `scale.kicad_wks`, containing a 50 by 10 mm rectangle, ticks every 10 mm,
   the 100% printing hint, and known outline dimensions and side information.
5. Run `kicad-cli pcb export pdf --mode-single`, selected layers, the generated drawing sheet,
   `--include-border-title`, and full drill shapes. Mirror and black-and-white flags follow
   the options. KiCad 10 also gets `--scale 1 --check-zones`. KiCad 9 uses fresh default plot
   parameters, and warns that zones are printed as last filled. The PDF timeout is 120 seconds.
6. Check the output is a regular file, no larger than 64 MiB, with a `%PDF-` header. Check the
   source snapshot again, rejecting a changed board rather than publishing inconsistent output.
   Publish the PDF and manifest together by renaming a ready directory into the cache.
7. If requested, atomically save into the safe workspace `fab/print/` directory and refresh
   workspace entries. Existing destination symlinks or non-files are rejected. Return a fresh
   signed URL on every call, including cache hits.

The scoped staging directory is removed after success, failure or fibre interruption. Print
requests serialize inside the helper to prevent duplicate cache publication. Existing cache
pruning applies. Filenames use a sanitized design stem and title-block revision, falling back
to eight source-hash characters.

Paper choices are the board page, A4, US Letter, A3 and US Ledger. Explicit standard choices
use landscape dimensions. A board page keeps its orientation and user dimensions. The fit
warning uses editor coordinates and 10 mm margins; it does not tile or reposition a board.
Actual CLI placement and physical output require the manual checks in TESTING.md.

## Signed files and source identity

`cache.ts` owns `SIGNED_FILE_TYPES` and its lookup helper. `board.glb` allows 128 MiB and
`model/gltf-binary`; `print.pdf` allows 64 MiB and `application/pdf`. Both signed resolution
and the HTTP route use this table. Unknown basenames, traversal, symlinks and oversized files
are rejected. The response has no Content-Disposition, so a direct PDF URL opens in the
browser viewer; the client supplies its download filename.

The source scanner excludes workspace `fab/` as well as `.loom/pcb-references`. This keeps
saved print and future fabrication outputs from creating new tscircuit revisions. L65 should
reuse this exclusion and add its archive entry to the same signed-file table.

## Client behavior

`TrueScalePrintDialog.tsx` offers side defaults, all board layers, shared layer presets,
mirroring, paper and monochrome choices. Its result-atom lease owns cancellation through the
RPC. Closing the dialog releases the lease. PDF downloads use the selected environment's
HTTP base URL, supporting local and remote connections without sending bytes over WebSocket.

The result retains an older PDF after the source changes and shows it as stale. Download
stays available; saving the stale result is disabled until a new PDF is created. Workspace
save repeats the same operation, reusing the cache. Open and Show in folder are available
only for the local desktop environment, with file-manager capability and shell command
permission; reveal additionally needs the server's reveal support. Remote clients use
Download. Displayed dimensions follow the PCB length preference; sheet text stays metric.

No production dependency, setting, database table or desktop-specific code is added. Browser
print dialogs, page tiling, merged top/bottom files and mobile remain outside this packet.
