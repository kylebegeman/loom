# L54 references

## Facts used

| Fact                                                                                                                            | Source                                                                                                                                                                                                                                                     | Verified                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1 in = 25.4 mm exactly; 1 mil = 0.001 in = 0.0254 mm.                                                                           | International yard and pound agreement (1959), [NIST SP 811, Appendix B](https://www.nist.gov/pml/special-publication-811)                                                                                                                                 | From the definition; not re-fetched                                                                     |
| `kicad-cli pcb drc --units` accepts mm (default), in or mils.                                                                   | [KiCad 10 CLI reference](https://docs.kicad.org/10.0/en/cli/cli.html), also [9.0](https://docs.kicad.org/9.0/en/cli/cli.html) and [8.0](https://docs.kicad.org/8.0/en/cli/cli.html)                                                                        | Yes, 2026-10-10                                                                                         |
| KiCad ERC JSON reports `pos` 100 times too small before 10.0.7 (the writer used the PCB scale); fixed in 10.0.7 as issue 25582. | [KiCad 10.0.7 release notes](https://www.kicad.org/blog/2026/10/KiCad-10.0.7-Release/), [Konnect issue 541](https://github.com/mixelpixx/Konnect/issues/541), [KiCad issue 16924 (8.0 rc symptom)](https://gitlab.com/kicad/code/kicad/-/work_items/16924) | Yes, 2026-10-10; also visible in `apps/server/src/fork/pcb-preview/fixtures/erc.json:28` (KiCad 10.0.6) |
| The report carries `kicad_version`, which picks the ERC correction.                                                             | `fixtures/drc.json` header; `kicadReports.ts:15`                                                                                                                                                                                                           | Yes, in source                                                                                          |
| Fab limits are commonly quoted in mils (OSH Park: 6 mil track and space, 10 mil drill).                                         | [OSH Park KiCad design rules](http://docs.oshpark.com/design-tools/kicad/kicad-design-rules/)                                                                                                                                                              | Yes, 2026-10-10                                                                                         |

## Prior art

- L40 (`docs/fork/packets/L40-model-units/`): the 3D panel's `formatLength`. Same names and
  option semantics; L54 adds mils and stores per device.
- KiCad's own unit switch (View, Units) toggles mm, mils and inches for display only and keeps
  internal units. Loom follows the same split. From KiCad documentation, not re-fetched.
- The Konnect MCP server's ERC correction: multiply below 10.0.7, trust 10.0.7 and later, drop
  coordinates for unknown builds. L54 uses the same rule. Konnect's licence was not checked;
  no code is reused.

## Licences

No code or data is reused. No dependency is added.
