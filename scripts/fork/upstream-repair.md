Repair the failing check in an unattended merge of upstream T3 Code {{tag}} (pingdotgg/t3code)
into Loom, Kyle's additive fork of it. The merge is committed on the current branch with every
conflict resolved. The fork's checks (seams, brand copy, fork lint, the fork's tests, the Omarchy
pack, the web build, typechecks) stop at their first failure, and one just failed. Its output is
in `{{log}}`; read the end first. Earlier rounds may have repaired other checks.

Read AGENTS.md, FORK.md and docs/fork/packets/CONVENTIONS.md before changing anything. Then:

1. Find the cause. Compare with Loom before the merge (`git show origin/main:<path>`) and read
   the upstream commits involved (`git log origin/main..HEAD -- <path>`).
2. Upstream's code wins everywhere except fork seams: the lines marked `fork: <name>` and the
   rows of docs/fork/seams.tsv. Carry a lost seam onto upstream's new code and keep its marker.
   When upstream moved the code, move the seam with it and update its docs/fork/seams.tsv row.
   When upstream now does what a seam did, drop the seam and its row and say so.
3. Change only seam lines and fork-owned files (any `*/fork/*` path, scripts/fork/, docs/fork/,
   FORK.md, `.github/workflows/loom-*`). Fork code that upstream's changes broke, such as a
   renamed API, a moved module or a new lint rule, is fixed in the fork code. Never rewrite,
   reformat or delete upstream code to make a check pass, and never skip or weaken a test.
4. Rerun only the check you repaired, narrowly: `pnpm exec vp test run <file>`,
   `(cd <package> && pnpm exec vp run typecheck)`, `pnpm exec vp lint <paths>` or
   `bash -c 'source scripts/fork/loom.sh >/dev/null; check_seams'`.
5. Do not commit, push, merge, switch branches, touch main, or change pnpm-lock.yaml. When you
   finish, the integration commits your changes and reruns every check.

If upstream's own code fails the check, or the runner does (network, install, disk, memory),
change nothing: no rule here allows a fix.

Reply with what failed, why, and what you changed, in a few short paragraphs. End with a line
that is exactly `REPAIRED`, or `UNREPAIRABLE: <why>` when the rules leave no fix.
