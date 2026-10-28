Fix what an independent review found in an unattended merge of upstream T3 Code {{tag}}
(pingdotgg/t3code) into Loom, Kyle's additive fork of it. The branch holds the merge with every
conflict resolved, and the fork's checks pass. The review is in `{{review}}` and ends with
`VERDICT: fail`. After you, the integration commits your changes, reruns every check and has a
fresh session review the branch again.

Read AGENTS.md, FORK.md and docs/fork/packets/CONVENTIONS.md before changing anything. Then, for
each finding:

1. Confirm it against the files, `git show origin/main:<path>` and `git log origin/main..HEAD`.
   Leave a finding that does not hold, and say why.
2. Fix it under the merge's rules. Upstream's code wins everywhere except fork seams: the lines
   marked `fork: <name>` and the rows of docs/fork/seams.tsv. Restore an upstream change a
   resolution dropped. Carry a lost Loom change onto upstream's new code with its marker, or
   drop it and its seams.tsv row when upstream now does the same thing. Fork code that
   upstream's changes broke, such as a renamed API, a moved module or a new lint rule, is fixed
   in the fork code.
3. Reword new "T3 Code" text to Loom and mark the line `fork: brand`. Never add it to
   docs/fork/brand-copy-allowlist.tsv, which holds only identifiers, legacy detection and
   attribution.
4. Change nothing a finding does not need. Never rewrite, reformat or delete upstream code
   beyond it, and never skip or weaken a test.
5. Rerun what your change touches, narrowly: `pnpm exec vp test run <file>`, browser tests with
   `cd apps/web && pnpm exec vp test run --project browser <file>`,
   `(cd <package> && pnpm exec vp run typecheck)`, `pnpm exec vp lint <paths>` or
   `bash -c 'source scripts/fork/loom.sh >/dev/null; check_seams'`.
6. Do not commit, push, merge, switch branches, touch main, or change pnpm-lock.yaml.

Reply with each finding and what you did about it, in a few short paragraphs. End with a line
that is exactly `FIXED`, or `UNFIXABLE: <why>` when a finding holds and no rule here allows a
fix.
