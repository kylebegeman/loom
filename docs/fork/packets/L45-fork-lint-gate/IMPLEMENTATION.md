# L45 implementation

Branch from `main`. Commits use `fix(fork-lint-gate): ...` for the fixes and
`feat(fork-lint-gate): ...` for the gate. Fix first, so the gate lands green.

1. **Confirm the findings.** Run
   `vp lint apps/web/src/fork apps/server/src/fork packages/contracts/src/fork
packages/client-runtime/src/fork apps/web/src/routes/settings.loom.tsx scripts/fork`.
   Compare with the table in TECHNICAL.md; fix whatever the command reports now.
2. **Outset rings.** Add `focus-visible:ring-inset` beside each `focus-visible:ring-2` in
   `CodeGraphPanel.tsx` (3), `FlowRunView.tsx`, `PillTabs.tsx`, `FileOutlineList.tsx` and
   `thread-inspector/parts.tsx`. One commit.
3. **Resize observers.** Swap the raw observers in `pcb-preview/Plot.tsx` and
   `pcb-preview/SvgViewport.tsx` for `observeResize`, keeping callback bodies and cleanup order.
   Run the PCB tests. One commit.
4. **Scroll gutter.** Add `scrollbar-gutter-both` to the scroller in `PanelPicker.tsx`. One
   commit. Step 1's command now exits 0.
5. **Gate.** Add `fork_lint_paths` and `check_fork_lint` to `scripts/fork/loom.sh` and call
   `check_fork_lint` in `run_checks` after the install. Add the tests in
   `scripts/fork/loom.test.ts`.
6. **Docs.** FORK.md commands table: the `check` row becomes "The fork's checks on the current
   checkout: seams, fork lint, fork tests, typechecks." CONVENTIONS.md "Merge safety" step 1:
   add "fork lint" to the list of what `loom.sh check` runs.

## Done when

- `scripts/fork/loom.sh check` prints "Linting fork code" and passes on the branch.
- Introducing a `focus-visible:ring-2` without `ring-inset` in any fork web file makes
  `loom.sh check` exit 1 with `loom: fork lint failed; ...` before the tests start.
- The code graph, Device QA, file outline and thread inspector focus rings are fully visible
  inside scrolling lists; the PCB plot and viewport track resizes; the panel picker list does
  not shift when its scrollbar appears.
- No `eslint-disable` or `oxlint-disable` comments were added.
