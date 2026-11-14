# Personal identifiers

This repository is public. Machine names, tailnet names, personal domains, home directories and account IDs belong in the maintainer's private platform repository, in GitHub variables, or in untracked local config. [`scripts/fork/personal-identifiers.ts`](../../../scripts/fork/personal-identifiers.ts) fails a change that adds one.

## Where it runs

- `vp run check:changed` checks the lines your branch adds since its merge base.
- `scripts/fork/loom.sh check` checks every line the fork adds on top of the upstream release it is based on, so any term on the deny list must match nothing at HEAD.
- The `Loom personal identifiers` workflow checks each pull request and each push to `main`.
- `node scripts/fork/personal-identifiers.ts --all` scans every tracked file, which helps when adding a deny-list term.

A line that upstream T3 Code already carries in the same file is exempt, so upstream merges never fail the check.

## Generic rules

These run everywhere, with no setup:

- Tailnet names that look real: `tail` plus hex digits, or two words such as `cobra-tuna`. Use `machine.tailnet.ts.net` or `tail1234`.
- Home directories under a real account name, such as `/Users/<name>/`. Use `/Users/me` or `/home/me`.
- UUIDs outside test files and fixture folders, unless they are obviously synthetic (RFC samples, repeated digits, `1234`, `abcd`, `0000`).

When a generic rule flags a reviewed placeholder or a public value, add a row to [`docs/fork/personal-identifier-allowlist.tsv`](../personal-identifier-allowlist.tsv): a path glob, a tab, and text the flagged line contains. The allowlist never exempts deny-list entries.

## The private deny list

Exact personal names and domains are not committed. The check reads them from the first source that exists:

1. `LOOM_PERSONAL_DENYLIST`, the list itself. In CI this is a repository secret of the same name, so GitHub masks the entries in logs.
2. `LOOM_PERSONAL_DENYLIST_FILE`, a path to the list.
3. `.personal-identifiers` at the root of this checkout.
4. `.personal-identifiers` at the root of the main checkout, so every worktree of it shares one file.

`.personal-identifiers` is gitignored. Without a list the check prints a note and runs the generic rules only.

One entry per line. Blank lines and lines starting with `#` are ignored. Every entry matches case-insensitively. An entry starting with `re:` is a regular expression; anything else is literal text.

```text
# machines
my-mac-name
re:\bmy-phone\b
# domains
my-domain.example
```

Keep the CI secret and the local files in step when you add a term.
