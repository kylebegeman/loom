# L45 product

## Problem

Upstream adds lint rules that encode real UI lessons (focus rings clipped by ancestors, layout
landing a frame late, centred lists jumping when a scrollbar appears). Fork code written before
or without those rules breaks them, and nothing tells us. On 2026-10-10,
`vp lint apps/web/src/fork` reports ten errors; the other fork paths are clean.

## What the user can do

Kyle (or an agent) runs `scripts/fork/loom.sh check` and gets a lint failure with file, line
and rule before tests run, instead of finding out when someone runs `vp check` by hand. Product
users get the fixes: keyboard focus rings that are not clipped in the code graph, Device QA,
thread inspector and file outline; PCB plot and viewport sizing that does not lag a frame; and a
panel picker list that stays put when the panel gets short enough to scroll.

## Entry points

| Way in                                                      | Way out                                                             | Where the state shows                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| `scripts/fork/loom.sh check`                                | Fix the findings and rerun                                          | Lint output, then `loom: fork lint failed; ...` |
| `scripts/fork/loom.sh integrate ...` (runs the same checks) | Fix on the `integrate/<tag>` branch, commit, `integrate --continue` | Same, and in the loom-upstream workflow log     |

## States

- Clean: one "Linting fork code" step, under two seconds today, then tests continue.
- Failing: findings print in `vp lint`'s default format; the script exits 1 with the message
  above.
- Missing path: a fork directory that does not exist on a branch is skipped, never an error.
- Disabled, empty, stale: not applicable.

## Surfaces and connection modes

Tooling runs on the maintainer's Mac and in the loom-upstream workflow. The UI fixes apply to
web and desktop; mobile has no fork code in these paths.

## Decisions

- Lint the fork-owned source paths only, not whole packages: upstream files are upstream's job,
  and whole-package lint would make the fork responsible for upstream regressions.
- `--deny-warnings`: fork paths have zero warnings today, so holding that line costs nothing.
- Run after `pnpm install` and before the tests: lint needs the installed plugins and fails in
  about a second, far sooner than the test run.
- Fix by following each rule's own message, no disable comments.

## Decisions needed from Kyle

1. Whether the gate also blocks upstream integration. `run_checks` is shared by `check` and
   `integrate` (`scripts/fork/loom.sh:473`), so by default a new upstream rule that flags fork
   code stops `integrate` and the unattended `--pr` workflow. Recommendation: yes, gate both. The
   fix is usually a class name, and it lands on the `integrate/<tag>` branch like any other
   merge repair. The alternative is a `check`-only gate, which would let integration merge code
   that `check` then rejects. Building to the recommendation is safe.
