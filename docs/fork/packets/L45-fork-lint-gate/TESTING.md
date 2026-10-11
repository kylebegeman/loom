# L45 testing

Focused tests only, no repo-wide checks.

## Results

Implementation branch: `feat/model-zones-overhangs-lint`, 2026-10-10. Milestones:
`6e1d3c668f` fixes the ten UI findings; `432ccf0511` adds the gate, isolated fixtures and
maintenance documentation.

| Check                                                | Result                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `scripts/fork/loom.test.ts`                          | Passed: 9 tests, including 6 gate fixtures and 3 preserved SQLite backup/rollback tests. |
| `apps/web/src/fork/pcb-preview/SvgViewport.test.tsx` | Passed: 2 existing viewport regressions.                                                 |
| Strict lint on the eight fixed web source files      | Passed with `--report-unused-disable-directives --deny-warnings`.                        |

The full `scripts/fork/loom.sh check` was not run: it installs dependencies, runs all fork
tests, builds the web client and typechecks its configured packages. Fixture tests prove its
gate ordering and failure behavior without performing those operations. Browser/desktop
interaction, a real resize observer callback, merge previews and upstream integration
rehearsals remain unrun. The integrated L34/L36/L45 batch passed 157 focused tests across
17 files, plus one isolated real OpenSCAD T-shape test (two older real tests skipped by name
filter). The new gate itself passed on all discovered fork paths, and contracts, web, server
and client-runtime package typechecks passed. Existing Effect suggestions are informational.

## Automated tests

`scripts/fork/loom.test.ts` is picked up by `fork_tests` through `*/fork/*.test.ts`.
Temporary repository fixtures source the script with `bash -c` and stub `pnpm`,
`check_seams`, `fork_tests` and `restore_lockfile`, so nothing installs, builds or touches the
real lockfile. Cases:

| Case                                     | Covers                                                                                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fork_lint_paths`                        | Lists only existing fork directories and Loom settings routes, including synthetic future desktop/shared paths and a second Loom route; skips unmatched globs and unrelated source. |
| Empty path list                          | Does not invoke lint, avoiding an accidental repository-wide check.                                                                                                                 |
| `check_fork_lint` passes flags and paths | A stub `pnpm` records its arguments: `exec vp lint --report-unused-disable-directives --deny-warnings` followed by the paths.                                                       |
| `check_fork_lint` fails loudly           | A stub `pnpm` returning 1 makes the function exit 1 with `fork lint failed` on stderr.                                                                                              |
| `run_checks` order                       | With stubs logging each call: install, then lint, then tests; with a failing lint, no test call is logged.                                                                          |

The lint fixes themselves are proven by the lint command. The observer swap must keep the
existing PCB tests green, notably `apps/web/src/fork/pcb-preview/SvgViewport.test.tsx` (it does
not stub `ResizeObserver`; `observeResize` is a no-op where the API is missing,
`apps/web/src/lib/observeResize.ts:71`).

## Commands

```sh
vp test run scripts/fork/loom.test.ts
vp test run apps/web/src/fork/pcb-preview/SvgViewport.test.tsx
bash -c 'source scripts/fork/loom.sh; check_fork_lint'
vp run --filter @t3tools/web typecheck
```

The gate-only command is safe after dependencies are present; it does not install or build.
The full `scripts/fork/loom.sh check` is the complete integration check for a suitable clean
checkout, not an additional focused check in this shared implementation pass.

## Manual check

1. Tab through the code graph symbol list, a Device QA flow run list and pill tabs, the file
   outline and the thread inspector: each focus ring is complete, not cut off at the list edge.
2. Open a PCB design, resize the panel: the plot and the board view follow without a visible
   jump.
3. Open the panel picker in a short panel so it scrolls: the list does not shift sideways.
4. Add `focus-visible:ring-2` to any fork button and run `scripts/fork/loom.sh check`: it stops
   at the lint step. Revert.

## Merge safety

No upstream files. `scripts/fork/loom.sh integrate nightly --dry-run` after merging confirms the
gate passes on the newest nightly; if a new upstream rule flags fork code, fix it as part of
that integration.
