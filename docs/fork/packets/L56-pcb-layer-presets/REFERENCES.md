# L56 references

## Facts used

| Fact                                                                                                                                                       | Source                                                                                                      | Verified                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| KiCad 7 and later name technical layers `F.Silkscreen`, `F.Courtyard`, `F.Fab`, `F.Mask`, `F.Paste`, `Edge.Cuts`; older files use `F.SilkS` and `F.CrtYd`. | [KiCad PCB Editor manual, board layers](https://docs.kicad.org/9.0/en/pcbnew/pcbnew.html)                   | Names confirmed against Loom's mapping in `semantics.ts:461-475`; the manual page was not re-fetched |
| Inner copper layers are `In1.Cu` to `In30.Cu`.                                                                                                             | Same manual                                                                                                 | From the manual and `usePcbPreview.logic.ts:48`; not re-fetched                                      |
| An assembly drawing is normally made from the fabrication, silkscreen and courtyard layers plus the outline.                                               | KiCad forum practice; [KiCad PCB Editor manual, plotting](https://docs.kicad.org/9.0/en/pcbnew/pcbnew.html) | Common practice, not a specification                                                                 |
| Silkscreen over exposed copper is clipped or rejected by fabs, so checking silk against the mask openings is a standard review.                            | [OSH Park KiCad design rules](http://docs.oshpark.com/design-tools/kicad/kicad-design-rules/)               | General guidance, 2026-10-10                                                                         |

## Prior art

- KiCad's Appearance panel offers built-in layer presets ("Front Assembly View", "Back
  Assembly View", "Front Layers", "Inner Copper Layers" and similar) beside user presets, which
  is the model this packet follows. Preset names are from memory of KiCad 7 to 9 and were not
  re-verified.
- Loom's own copper presets (`LayersTab.tsx:31-35`, `usePcbPreview.logic.ts:29-52`).

## Licences

No code or data is reused. No dependency is added.
