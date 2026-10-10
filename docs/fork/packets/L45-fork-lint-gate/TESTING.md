# L45 testing

Focused tests only, no repo-wide checks.

## Automated tests

`scripts/fork/loom.test.ts` (existing; picked up by `fork_tests` through `*/fork/*.test.ts`).
Add a small helper beside `run()` that sources the script with `bash -c` and stubs `pnpm`,
`check_seams`, `fork_tests` and `restore_lockfile`, so nothing installs, builds or touches the
real lockfile. Cases:

| Case                                     | Covers                                                                                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fork_lint_paths`                        | Lists `apps/web/src/fork`, `apps/server/src/fork`, `packages/contracts/src/fork`, `packages/client-runtime/src/fork`, `apps/web/src/routes/settings.loom.tsx` and `scripts/fork`; every listed path exists; exits 0. |
| `check_fork_lint` passes flags and paths | A stub `pnpm` records its arguments: `exec vp lint --report-unused-disable-directives --deny-warnings` followed by the paths.                                                                                        |
| `check_fork_lint` fails loudly           | A stub `pnpm` returning 1 makes the function exit 1 with `fork lint failed` on stderr.                                                                                                                               |
| `run_checks` order                       | With stubs logging each call: install, then lint, then tests; with a failing lint, no test call is logged.                                                                                                           |

The lint fixes themselves are proven by the lint command. The observer swap must keep the
existing PCB tests green, notably `apps/web/src/fork/pcb-preview/SvgViewport.test.tsx` (it does
not stub `ResizeObserver`; `observeResize` is a no-op where the API is missing,
`apps/web/src/lib/observeResize.ts:71`).

## Commands

```sh
vp test run scripts/fork/loom.test.ts
vp test run apps/web/src/fork/pcb-preview
vp lint --report-unused-disable-directives --deny-warnings apps/web/src/fork \
  apps/server/src/fork packages/contracts/src/fork packages/client-runtime/src/fork \
  apps/web/src/routes/settings.loom.tsx scripts/fork
vp run --filter @t3tools/web typecheck
```

Then once, at the end: `scripts/fork/loom.sh check`.

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
