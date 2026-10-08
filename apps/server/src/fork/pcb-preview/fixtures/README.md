# KiCad report fixtures

Generated with KiCad 10.0.6 from its bundled `demos/complex_hierarchy` project.
Commands: `sch erc` and `pcb drc` with `--format json --severity-all --units mm
--exit-code-violations`; DRC also uses `--schematic-parity`. Both returned exit 5.
The reported CLI totals were 40 ERC violations and 68 schematic parity issues
(no ordinary DRC violations or unconnected items). The report source path is
normalized; the report findings are unchanged. These are report-parser fixtures,
not claims that this demo is ready for fabrication.
