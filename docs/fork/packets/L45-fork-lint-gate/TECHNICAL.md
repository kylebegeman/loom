# L45 technical

## Overview

Two parts: make fork code lint-clean, then make `run_checks` keep it that way.

## Contracts, server, storage

None.

## Current findings

`vp lint apps/web/src/fork` on 2026-10-10 (exit 1, 10 errors, 0 warnings). `apps/server/src/fork`,
`packages/contracts/src/fork`, `packages/client-runtime/src/fork`,
`apps/web/src/routes/settings.loom.tsx` and `scripts/fork` are clean with `--deny-warnings`.

| File:line                                                                           | Rule                                    | Feature |
| ----------------------------------------------------------------------------------- | --------------------------------------- | ------- |
| `apps/web/src/fork/code-graph/CodeGraphPanel.tsx:119`                               | `t3code/no-outset-state-indicators`     | L26     |
| `apps/web/src/fork/code-graph/CodeGraphPanel.tsx:494`                               | `t3code/no-outset-state-indicators`     | L26     |
| `apps/web/src/fork/code-graph/CodeGraphPanel.tsx:795`                               | `t3code/no-outset-state-indicators`     | L26     |
| `apps/web/src/fork/device-qa/FlowRunView.tsx:406`                                   | `t3code/no-outset-state-indicators`     | L09     |
| `apps/web/src/fork/device-qa/PillTabs.tsx:47`                                       | `t3code/no-outset-state-indicators`     | L09     |
| `apps/web/src/fork/file-outline/FileOutlineList.tsx:101`                            | `t3code/no-outset-state-indicators`     | L05     |
| `apps/web/src/fork/thread-inspector/parts.tsx:252`                                  | `t3code/no-outset-state-indicators`     | L04     |
| `apps/web/src/fork/pcb-preview/Plot.tsx:44`                                         | `t3code/no-raw-resize-observer`         | L24     |
| `apps/web/src/fork/pcb-preview/SvgViewport.tsx:188`                                 | `t3code/no-raw-resize-observer`         | L24     |
| `apps/web/src/fork/panel-picker/PanelPicker.tsx:37` (reported at the `<div>` on 33) | `t3code/require-centered-scroll-gutter` | L12     |

The implementing agent reruns the command first; line numbers move.

## Fix pattern per rule

**`no-outset-state-indicators`** (`oxlint-plugin-t3code/rules/no-outset-state-indicators.ts`,
enabled for `apps/web/src/**` in `vite.config.ts:269-273`). A `ring-2` without `ring-inset`
paints outside the element, where a scrolling or `overflow-hidden` ancestor clips it. All seven
findings are `focus-visible:ring-2 focus-visible:ring-ring`. Add `focus-visible:ring-inset` to
the same class string. The rule's message lists the other accepted fixes (drop a positive
outline offset, or use a negative offset at least as wide as the outline); the inset ring is the
smallest change here.

**`no-raw-resize-observer`** (`rules/no-raw-resize-observer.ts`, `vite.config.ts:253-262`). State
set in a raw `ResizeObserver` callback commits after paint, one frame late. Use
`observeResize(elements, callback)` from `~/lib/observeResize`
(`apps/web/src/lib/observeResize.ts:67`), which shares one observer, flushes all callbacks in one
`flushSync`, delivers an initial measurement and returns an unsubscribe function. The callback
receives `readonly ResizeObserverEntry[]` (`observeResize.ts:3`).

- `Plot.tsx:42-49`: replace the observer, `observe` and `disconnect` with
  `return observeResize(node, ([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 0)));`.
- `SvgViewport.tsx:186-191,207`: replace `const resize = new ResizeObserver(...)` and
  `resize.observe(node)` with `const stopResize = observeResize(node, ([entry]) => { ... })`
  with the same body, and `resize.disconnect()` in the cleanup with `stopResize()`.

**`require-centered-scroll-gutter`** (`rules/require-centered-scroll-gutter.ts`, `error` in
`vite.config.ts:176`). A scroller that centres its content shifts sideways when its scrollbar
appears. Add `scrollbar-gutter-both` to the class at `PanelPicker.tsx:37`, exactly as upstream's
launcher does (`apps/web/src/components/RightPanelTabs.tsx:521`), which the fork's comment says
it matches.

## The gate

In `scripts/fork/loom.sh`, next to `fork_tests`:

```bash
# Fork-owned source the lint gate covers. Upstream files with fork seams are left
# to upstream's own lint.
fork_lint_paths() {
  local path
  for path in apps/*/src/fork packages/*/src/fork apps/web/src/routes/settings.loom*.tsx \
    scripts/fork; do
    if [ -e "$path" ]; then printf '%s\n' "$path"; fi
  done
}

check_fork_lint() {
  say "Linting fork code"
  local paths=()
  while IFS= read -r p; do paths+=("$p"); done < <(fork_lint_paths)
  pnpm exec vp lint --report-unused-disable-directives --deny-warnings "${paths[@]}" ||
    die "fork lint failed; fix the findings above (rules in oxlint-plugin-t3code/rules/)"
}
```

`run_checks` calls `check_fork_lint` right after `pnpm install --frozen-lockfile` and before the
tests. The flags match the root `lint` script (`package.json:29`) plus `--deny-warnings`. The
globs pick up a future `apps/desktop/src/fork` or `packages/shared/src/fork` with no edit; an
unmatched glob stays literal and is skipped by the `-e` test. The header comment
(`loom.sh:22-23`, "check runs the fork's checks") stays accurate.

Because `cmd_integrate` calls `run_checks` (`loom.sh:473`), integration and the loom-upstream
workflow's `--pr` path are gated too, per the recommendation in PRODUCT.md.

## Clients

Only the class and observer fixes above. No new UI.

## Agent-facing tools

None. Agents already run `scripts/fork/loom.sh check` (`.github/workflows/loom-claude.yml:67`
tells them to); they get the gate for free.

## Performance

The lint step takes about half a second on the four clean paths and about one second on
`apps/web/src/fork` today (oxlint, `typeAware: false`, `vite.config.ts:402-407`). The
`observeResize` swaps remove a frame of layout lag in the PCB views.

## Alternatives considered

- Run `vp check` or `vpr lint` on the whole repo: slow, and it would fail on upstream issues the
  fork does not own.
- Lint only files changed since `main`: misses errors that new upstream rules expose in
  untouched fork code, which is exactly how today's ten arrived.
- Rely on upstream's `ci.yml` lint job: it targets `blacksmith-8vcpu-ubuntu-2404` runners
  (`.github/workflows/ci.yml:22`), which the fork's repository is not known to have (not
  verified), and today's errors show it is not gating fork merges.
- Disable comments on the ten lines: hides real defects and the rules' reasons.
