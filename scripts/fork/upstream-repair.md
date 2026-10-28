Repair one failing check in an unattended merge of upstream T3 Code {{tag}} (pingdotgg/t3code)
into Loom, Kyle's additive fork of it. The merge is committed on the current branch with every
conflict resolved. The fork's checks (seams, brand copy, fork lint, lint of the upstream files the
fork edits, the Omarchy pack, the web build, typechecks, the fork's tests, browser tests in
apps/web) all ran, and "{{check}}" failed. Its output is in `{{log}}`; the whole pass is in
`{{all}}`. Other failing checks each have their own session, so fix only this one. Earlier
sessions may have committed repairs already.

Read AGENTS.md, FORK.md and docs/fork/packets/CONVENTIONS.md before changing anything. Then:

1. Find the cause. Compare with Loom before the merge (`git show origin/main:<path>`) and read
   the upstream commits involved (`git log origin/main..HEAD -- <path>`).
2. Upstream's code wins everywhere except fork seams: the lines marked `fork: <name>` and the
   rows of docs/fork/seams.tsv. Carry a lost seam onto upstream's new code and keep its marker.
   When upstream moved the code, move the seam with it and update its docs/fork/seams.tsv row.
   When upstream now does what a seam did, drop the seam and its row and say so.
3. Change only seam lines and fork-owned files (any `*/fork/*` path, scripts/fork/, docs/fork/,
   FORK.md, `.github/workflows/loom-*`, and any file {{tag}} lacks). Fork code that upstream's
   changes broke, such as a renamed API, a moved module or a new lint rule, is fixed in the
   fork code. Never rewrite, reformat or delete upstream code to make a check pass, and never
   skip or weaken a test.
4. Reword new "T3 Code" text to Loom and mark the line `fork: brand`. Never add it to
   docs/fork/brand-copy-allowlist.tsv, which holds only identifiers, legacy detection and
   attribution.
5. Rerun only the check you repaired, narrowly: `pnpm exec vp test run <file>`, browser tests
   with `cd apps/web && pnpm exec vp test run --project browser <file>`,
   `(cd <package> && pnpm exec vp run typecheck)`, `pnpm exec vp lint <paths>` or
   `bash -c 'source scripts/fork/loom.sh >/dev/null; check_seams'`.
6. Do not commit, push, merge, switch branches, touch main, or change pnpm-lock.yaml. When you
   finish, the integration commits your changes and reruns every check.

If upstream's own code fails the check, or the runner does (network, install, disk, memory),
change nothing: no rule here allows a fix. A failure that is only large or slow to fix is not
that. Fix what you can and say what is left; the integration commits your work and the next
round continues from it.

Reply with what failed, why, and what you changed, in a few short paragraphs. End with a line
that is exactly `REPAIRED`, or `UNREPAIRABLE: <why>` when the rules leave no fix.
