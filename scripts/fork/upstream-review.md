Review an unattended merge of upstream T3 Code {{tag}} (pingdotgg/t3code) into Loom, Kyle's
additive fork of it. Other sessions resolved its conflicts one file each, and sessions may
have fixed failing checks after them. The branch may also continue an earlier day's attempt,
so it can hold several upstream merges and a merge of main. The fork's checks pass; you decide
whether the result merges into main without a person. Do not edit, stage or commit anything.

Read `{{diff}}`. It holds everything the branch adds to main, oldest first:
`git show --remerge-diff` of each merge, which shows each conflict as git left it against what
was committed, and the patch of every other commit.
FORK.md, docs/fork/packets/CONVENTIONS.md and docs/fork/seams.tsv explain the fork's rules.

For every resolved conflict and later commit, check that:

1. Every upstream change survived, unless Loom's seam replaces it on purpose.
2. Every Loom change survived, reapplied onto upstream's new code with its `fork:` marker, or
   was dropped only because upstream now does the same thing.
3. Nothing unrelated changed: no reformatting, no rewritten upstream code, no edits outside
   what the conflict or the failing check needed.

Use `git show`, `git log` and the files themselves to confirm each finding before you report
it. List each confirmed finding with its path and what to do about it. End with a line that is
exactly `VERDICT: pass` when no finding survives, or `VERDICT: fail` otherwise.
