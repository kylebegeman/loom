# L34 references

## Old Loom

No old Loom equivalent. The H2D and H2C presets come from L23 and commit `8676e099e5`; their
volumes were marked unverified in L23 REFERENCES.md.

## Loom source this packet builds on

- `packages/contracts/src/fork/model-preview-3d.ts:155-166`: H2D and H2C presets and notes.
- `apps/web/src/fork/model-preview-3d/viewer/bed.ts:59-94`: the bed group and its render order.
- `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts:379-390`, `:410-440`: theme,
  `setBed`, `placeBed`.
- `apps/web/src/fork/model-preview-3d/viewer/views.ts:7`: the front view looks from -Y.
- `apps/web/src/fork/model-preview-3d/ModelInspector.tsx:184-272`, `:356-423`: Part's top view
  and fit card.
- L32 TECHNICAL.md: `fitOnBed`, `BedFitSummary`, `bedFitSummary`.

## Primary source: Bambu Studio machine profiles (verified 2026-10-10)

Repository `bambulab/BambuStudio`, branch `master`, licence AGPL-3.0. Only numeric facts are
used; no code or data files are copied, so the licence does not apply to Loom's code.

- `resources/profiles/BBL/machine/Bambu Lab H2D 0.4 nozzle.json`
  (https://github.com/bambulab/BambuStudio/blob/master/resources/profiles/BBL/machine/Bambu%20Lab%20H2D%200.4%20nozzle.json):
  `printable_area` 0x0, 350x0, 350x320, 0x320; `extruder_printable_area`
  "0x0,325x0,325x320,0x320" (first extruder) and "25x0,350x0,350x320,25x320" (second);
  `master_extruder_id` "2"; inherits `fdm_bbl_3dp_002_common`.
- `resources/profiles/BBL/machine/Bambu Lab H2C 0.4 nozzle.json`
  (https://github.com/bambulab/BambuStudio/blob/master/resources/profiles/BBL/machine/Bambu%20Lab%20H2C%200.4%20nozzle.json):
  `printable_area` 0x0, 330x0, 330x320, 0x320; `extruder_printable_area`
  "0x0,325x0,325x320,0x320" and "25x0,330x0,330x320,25x320".
- `resources/profiles/BBL/machine/fdm_bbl_3dp_002_common.json`
  (https://github.com/bambulab/BambuStudio/blob/master/resources/profiles/BBL/machine/fdm_bbl_3dp_002_common.json):
  `extruder_printable_height` ["320", "325"]; `printable_height` "325". Neither H2 file
  overrides the heights.

Inference, labelled: the first extruder is the left nozzle. Its area starts at X 0, so it is
the nozzle that cannot reach the right edge; this matches Bambu's spec pages, which give the left
nozzle a 320 mm height. Profile coordinates start at the plate's front-left corner, which is how
Bambu Studio draws its plate.

## Bambu Lab spec pages (official, not fetched directly)

Both pages returned HTTP 403 to the fetch tool on 2026-10-10. The figures below come from search
result extracts of the pages and agree with the profiles. **Kyle should glance at the live pages
once.**

- H2D tech specs, https://bambulab.com/en/h2d/tech-specs: single nozzle 325 x 320 x 325 mm,
  dual nozzle 300 x 320 x 320 mm, total volume for two nozzles 350 x 320 x 320 mm, enabled by
  identical filaments in both nozzles. The single-nozzle figure is the right nozzle; the page
  does not split left and right in the extract.
- H2C specs, https://bambulab.com/en/h2c/specs: left nozzle 325 x 320 x 320 mm, right nozzle
  305 x 320 x 325 mm, dual nozzle 300 x 320 x 320 mm, total 330 x 320 x 320 mm.
- Bambu compare page, https://bambulab.com/en-us/compare: the same 320 mm dual-nozzle height
  (search extract).

## Sources that disagree

- H2D store page, https://us.store.bambulab.com/products/h2d, and the H2D launch post,
  https://blog.bambulab.com/bambu-lab-launches-h2d-to-rethink-personal-manufacturing/: dual
  nozzle 300 x 320 x 325 mm and total 350 x 320 x 325 mm (search extracts). Older and looser
  than the profile; not used.
- H2C store page, https://us.store.bambulab.com/products/h2c: advertises 330 x 320 x 325 mm, the
  widest width with the tallest height. Matches the outer `volumeMm`, not any one nozzle.

## Bambu Lab wiki (not fetched)

https://wiki.bambulab.com/en/h2/manual/printable-range-for-dual-nozzles and
https://wiki.bambulab.com/en/h2/manual/max-printable-area describe the same areas, including
Bambu Studio's "left nozzle only area" and "right nozzle only area" plate markings. Both returned
HTTP 402 to the fetch tool; **not verified**.
