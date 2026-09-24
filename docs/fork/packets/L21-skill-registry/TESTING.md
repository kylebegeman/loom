# L21 testing

Focused tests, no repo-wide checks, no sleeps, no network. Filesystem tests use a temp
directory; git tests use a local bare repository through an injected URL policy.

## Automated tests

| File                                                         | Covers                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/skill-registry.test.ts`         | Tag prefixes `loom.skill-registry.`; scaffold name pattern; `InstallTarget` and `SkillInventory` round-trip.                                                                                                                                                                                                               |
| `apps/server/src/fork/skill-registry/knownRoots.test.ts`     | Roots for default and custom Claude config dirs, Codex shadow homes (effective home), `~/.agents`, project roots; no duplicates.                                                                                                                                                                                           |
| `apps/server/src/fork/skill-registry/SkillScanner.test.ts`   | Real path and `viaSymlink` for a symlinked `skills` folder; malformed frontmatter reported; budget truncation sets `scanTruncated`; scripts detected by executable bit and `scripts/` folder; files over 256 KB not read.                                                                                                  |
| `apps/server/src/fork/skill-registry/mergeInventory.test.ts` | A shared folder seen by two Claude instances merges into one entry with two visibilities; a same-name project skill shadowed by the user copy is flagged; path-less plugin skills get their own entries; installs attach by real path; content changes set `modifiedSinceInstall`; `editable` false for plugin and system. |
| `apps/server/src/fork/skill-registry/toggles.test.ts`        | Claude: writes `"off"`/`"on"` into the right file for project, account and all accounts; keeps other keys; refuses files with comments; uses the repository root's `settings.local.json` when the project is nested; atomic write. Codex: sends `skills/config/write` with the path (fake client).                         |
| `apps/server/src/fork/skill-registry/sources.test.ts`        | URL policy rejects `http:`, credentials, query strings, private hosts; clone command has hooks disabled, no submodules, prompt disabled; scan finds `SKILL.md` up to depth 4 and skips `.git` and `node_modules`; progress events precede `fetched`.                                                                       |
| `apps/server/src/fork/skill-registry/installs.test.ts`       | Copy writes the marker and record; refuses an existing folder; skips symlinks pointing outside the clone; update replaces and moves the old copy to trash; update refuses a modified install without `force`; remove moves to trash and refuses non-Loom skills. Uses `SqlitePersistenceMemory`.                           |
| `apps/server/src/fork/skill-registry/validate.test.ts`       | Missing and malformed frontmatter; name mismatch warning; description length; YAML 1.1 booleans (`yes`, `off`); unknown keys as warnings.                                                                                                                                                                                  |
| `apps/web/src/fork/skill-registry/inventory.logic.test.ts`   | Filters (provider, scope, state, search), badge derivation, shared-folder note text.                                                                                                                                                                                                                                       |

Registry invariants (panel id and letter, palette values, keybinding command) come from the
extension point tests.

## Commands

```sh
vp test run packages/contracts/src/fork/skill-registry.test.ts \
  apps/server/src/fork/skill-registry \
  apps/server/src/fork/rpcAuthorization.test.ts \
  apps/web/src/fork/skill-registry/inventory.logic.test.ts \
  apps/web/src/fork/panels/registry.test.ts \
  packages/contracts/src/fork/keybindings.test.ts

vp lint packages/contracts/src/fork apps/server/src/fork apps/web/src/fork packages/client-runtime/src/fork

vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
```

## Manual check

With Kyle's permission for a dev server and browser. Scratch folders under `.t3/scratch/`.

1. Configure two scratch Claude instances whose config dirs share one `skills` symlink, one
   scratch Codex instance, and a scratch project with `.claude/skills` and `.agents/skills`.
2. Open a thread in the project, open Skills (launcher K). The shared skill shows once with
   both Claude accounts; project skills show the Project badge; Codex skills show their scope.
3. Turn a Claude skill off for the project; the `$` menu in that project no longer offers it
   (after the refresh); turn it on again.
4. Turn a Codex skill off; the Codex scope note shows; turn it back on.
5. Sources: fetch `https://github.com/DietrichGebert/ponytail` (with Kyle's consent for the
   network access), install `skills/ponytail` into the scratch Claude folder; it appears with
   the Loom badge; "Check for updates" says up to date; remove it; it is in the trash folder.
6. Lab: create `release-notes` in the project's `.claude/skills`, edit, see validation, "Test
   in new thread" opens a new thread with `$release-notes` in the composer; send it on the
   scratch Claude instance.
7. Upstream server: the launcher entry is disabled with "Needs a Loom server".

## Acceptance criteria

- The flows in PRODUCT.md work on web and desktop, locally and remotely.
- No file outside the named provider files, the chosen skill folders and Loom's state folder
  is created, changed or removed (verify with a before/after listing of the scratch tree).
- Opening the panel twice within five minutes starts no new Codex app-server for project
  probes (cache hit).

## Merge safety

Merge preview from CONVENTIONS.md on the packet branch, recorded in SEAMS.md; conflicts only
on `fork: ext-*` lines. After Kyle merges, `scripts/fork/loom.sh integrate nightly --dry-run`
from a clean, synced `main`.
