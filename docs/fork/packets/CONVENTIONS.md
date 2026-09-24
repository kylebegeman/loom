# Packet conventions

Rules every Loom packet follows. They exist so that each packet can be built by one agent in
isolation and so that `scripts/fork/loom.sh integrate` keeps merging upstream T3 Code with
conflicts only on a short, known list of seam lines. The repository's `AGENTS.md` still
applies in full; this file only adds the fork rules.

## Where fork code lives

New code goes in fork-owned directories. Upstream never creates files there, so they never
conflict.

| Package                   | Fork directory                                                | Packet code                                                                                       |
| ------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/contracts`      | `src/fork/`, exported as `@t3tools/contracts/fork`            | `src/fork/<slug>.ts` (schemas, RPC group)                                                         |
| `packages/client-runtime` | `src/fork/`, exported as `@t3tools/client-runtime/fork`       | `src/fork/<slug>.ts` (atoms shared by web and mobile), `src/fork/<slug>-<name>.ts` (pure helpers) |
| `packages/shared`         | `src/fork/` (add a subpath export only if a packet needs one) | `src/fork/<slug>.ts`                                                                              |
| `apps/server`             | `src/fork/`                                                   | `src/fork/<slug>/` (services, handlers, tools)                                                    |
| `apps/web`                | `src/fork/`                                                   | `src/fork/<slug>/` (components, hooks, state)                                                     |
| `apps/desktop`            | `src/fork/`                                                   | `src/fork/<slug>/` (Electron-only work)                                                           |
| `apps/mobile`             | `src/fork/`                                                   | `src/fork/<slug>/`                                                                                |
| `docs/fork/packets/`      | one folder per packet                                         | `Lxx-slug/`                                                                                       |

Exceptions, which live in upstream directories because a tool requires it, and are listed in
the packet's `SEAMS.md`:

- Web routes: TanStack Router only discovers `apps/web/src/routes/*.tsx`. Fork routes are
  named `settings.loom*.tsx` or `loom.*.tsx`, and `routeTree.gen.ts` changes with them (see
  [EXTENSION-POINTS.md, Settings](./EXTENSION-POINTS.md#7-settings-ext-settings)).
- Tests sit next to the file they test, inside the fork directory.

The extension points themselves (registries, `ForkLayer`, the fork RPC group) live in the
same fork directories, outside any packet folder. See EXTENSION-POINTS.md for the exact
files.

## Naming

| Thing                         | Form                                     | Example                         |
| ----------------------------- | ---------------------------------------- | ------------------------------- |
| Packet slug                   | kebab-case, from the packet index        | `thread-lineage`                |
| Seam marker                   | `fork: <slug>` or `fork: ext-<name>`     | `// fork: snippets`             |
| RPC method tag                | `loom.<slug>.<verb>`                     | `loom.snippets.list`            |
| Keybinding command            | `loom.<slug>.<action>`                   | `loom.snippets.open`            |
| MCP tool name                 | `loom_<slug_underscored>_<verb>`         | `loom_snippets_search`          |
| SQLite table                  | `fork_<slug_underscored>_<noun>`         | `fork_snippets_entries`         |
| Fork migration tracking table | `fork_migrations_<slug_underscored>`     | `fork_migrations_snippets`      |
| Files on the server           | `<stateDir>/fork/<slug>/`                | `~/.t3/userdata/fork/snippets/` |
| Client storage keys           | `loom:<slug>:<name>:v<n>`                | `loom:snippets:recent:v1`       |
| Environment capability entry  | the slug, in `capabilities.loomFeatures` | `"snippets"`                    |
| Right panel id                | `<slug>` or `<slug>:<name>`              | `snippets`                      |
| Desktop IPC channel           | `loom:<slug>:<name>`                     | `loom:apple-build-tooling:run`  |
| Settings section id           | the slug, or the extension point name    | `snippets`, `decide`            |

The MCP tool example is illustrative; L01 ships no MCP tools. Extension points that own wire
names, tables or a capability use their short name in place of the slug: `core`
(`loom.core.info`, capability `core`) and `decide` (`loom.decide.*`, `fork_decide_*`,
`fork_migrations_decide`, capability and settings section `decide`). No packet may use these
as its slug.

Wire names and user-facing identifiers say "loom"; code paths and database objects say
"fork". Never reuse an upstream name, and never rename an upstream identifier (FORK.md,
"Identifiers kept on purpose").

## Seams

A seam is any line a fork change adds to or edits in an upstream-owned file. Keep them
minimal: an import, a registry call, a spread, a union member. Put logic in fork files.

Every seam line carries a marker comment in the file's own comment syntax. Packet documents
show seams as `diff` blocks, because the Markdown formatter rewrites partial `ts` snippets:

```diff
 import { websocketRpcRouteLayer } from "./ws.ts";
+import { ForkLayer, ForkRoutesLayer } from "./fork/ForkLayer.ts"; // fork: ext-core
```

```diff
           <ProjectCloneToastCoordinator />
+          {/* fork: ext-web-root */}
+          <ForkRoot />
```

Rules:

- The marker is exactly `fork: <slug>` after `//`, `/*`, `{/*`, `<!--` or `#`, optionally
  followed by `: reason`. The existing branding seams use `fork: brand` in the same form.
- Extension point seams use `fork: ext-<name>`. A packet's own seams use its slug.
- A short single-line seam carries the marker at the end of the line. A multi-line seam, or
  any line the formatter might wrap (code longer than about 90 characters), gets the marker
  on its own line directly above it, so `vp fmt` can never separate the two. A multi-line seam
  ends at the end of its statement or JSX expression.
- Prefer inserting a new line over editing an upstream line. When inserting into a list
  that upstream appends to, insert at the start of the list, not the end, unless the order
  is user-visible (EXTENSION-POINTS.md says where).
- JSON files cannot carry a marker. List those seams in the packet's `SEAMS.md` and in
  FORK.md with "(no marker)", as the branding seams already do.
- Never reformat, reorder or "clean up" upstream code around a seam.

### Updating FORK.md

A packet that adds seams adds one row per upstream file to FORK.md's seam tables, in the
same commit as the seams:

- Extension point seams go in a table headed "Extension point seams", created by the first
  extension point with the columns `File`, `Marker`, `Why`.
- Packet seams go in a table headed "Packet seams" with the columns `File`, `Packet`, `Why`.
  `Packet` is the packet slug in backticks, for example `` `file-outline` ``.

Keep each "Why" to one line and point at the packet folder for detail.

## Commits

Commit style is conventional commits in plain language. The trailer from the session's
attribution rules is optional for packet agents; normal commits are fine.

- Creating an extension point: its own commit, containing only the extension point exactly
  as EXTENSION-POINTS.md specifies it, for example
  `feat(fork): add the right panel extension point`.
- Packet work: `feat(fork-<slug>): <what the user can now do>`, for example
  `feat(fork-snippets): expand snippet aliases with Tab`. Fixes use `fix(fork-<slug>): ...`.
- Packet documents: `docs(fork-<slug>): ...`.

Never commit on `main` directly unless Kyle asks, never push, never open a pull request
unless asked, and never commit `pnpm-lock.yaml` (below).

## The lockfile rule

pnpm's automatic install on this machine rewrites one peer-dependency hash in
`pnpm-lock.yaml`. That change is local noise. Before every commit:

```sh
git diff --quiet -- pnpm-lock.yaml || git checkout -- pnpm-lock.yaml
```

A packet that genuinely needs a new dependency asks Kyle first (a new production dependency
needs approval), and then commits only the intended lockfile change.

## Safety rules from AGENTS.md

- Never kill a process by pattern. Kill only a PID you captured at spawn.
- Never start a server against `~/.t3/userdata`, open it read-write, or clean it up. Seed a
  worktree's `.t3` with `VACUUM INTO` (AGENTS.md, "Test data").
- Never set `VITE_HTTP_URL` or `VITE_WS_URL` for dev.
- Ask before computer use, browsers or dev servers. Subagents never start dev servers.

## Verification

Run the smallest proof that the change works. Never run repo-wide checks (`vp check`,
`vp run -r test`, `vp run -r typecheck`); CI owns those.

```sh
vp test run <test files you added or touched>
vp lint <files you changed>
vp run --filter <package> typecheck   # once per package you changed
```

Package names for `--filter`: `t3` (apps/server), `@t3tools/web`, `@t3tools/desktop`,
`@t3tools/mobile`, `@t3tools/contracts`, `@t3tools/client-runtime`, `@t3tools/shared`.
Changing `packages/contracts` means typechecking every package that imports what you
changed (server, web, and client-runtime at least). A web route change needs the route tree
regenerated before typecheck (EXTENSION-POINTS.md, Settings).

Server behavior ships with focused tests. Wait on receipts, worker drains or deferreds,
never on sleeps. Registry tests check real invariants (unique ids, prefixes, no collision
with upstream names), not markup.

Mobile changes also run `vp run lint:mobile`.

### Merge safety

A packet is only done if the next upstream merge still applies cleanly.

1. While working on a branch, preview the merge without touching the worktree:

   ```sh
   git fetch -q upstream --tags
   tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
   git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
   ```

   Exit status 0 means no conflicts. Otherwise the listed files conflict; every one of them
   must be a file your `SEAMS.md` lists, and the conflict must be on a marked line.

2. After the packet is merged to `main` (Kyle's step), run the full rehearsal from a clean,
   synced `main`:

   ```sh
   scripts/fork/loom.sh integrate nightly --dry-run
   ```

   It merges the newest nightly on a throwaway branch, checks the seams, runs the fork
   tests and typechecks, builds the app, then discards everything. It needs a clean tree
   and `main` equal to `origin/main`, so an agent on a packet branch cannot run it.

### Known gap in `loom.sh` (follow-up, not part of any packet)

`run_checks` only knows the branding seams: `SEAM_FILES` lists files that must still contain
`fork: brand`, `FORK_TESTS` lists four branding tests, and `TYPECHECK_DIRS` covers
`packages/shared apps/desktop apps/web scripts`, which leaves out `apps/server`,
`packages/contracts` and `packages/client-runtime`. Proposed generalization, to do as a
separate `fix(fork)` change once the first extension point lands:

- Add `docs/fork/seams.tsv` with one row per seam file: `path<TAB>marker<TAB>minimum count`
  (for example `apps/server/src/server.ts	ext-core	3`). Rows for JSON seams use the
  marker `-` and are checked by a content grep instead.
- Replace the `SEAM_FILES` loop with: for each row, count
  `grep -cE "(//|/\*|<!--|#) fork: <marker>([^a-z0-9-]|$)" <path>` and fail below the
  minimum. The comment prefix matters: `git grep "fork: "` alone also matches upstream code
  such as the `fork: (workerPath: string) => ...` key in
  `apps/desktop/src/snapShot/RegionSnapShot.ts:64`.
- Add a reverse check: every marker found by
  `git grep -nE '(//|/\*|<!--|#) fork: [a-z0-9-]+([^a-z0-9-]|$)' -- . ':(exclude)docs/'`
  must belong to a file listed in the manifest, so an undocumented seam fails the
  integration. The pathspec excludes `docs/`, because packet documents quote seam diffs
  with real markers, and the regex is the same strict form as the forward check (comment
  prefix, then a complete slug).
- Derive `FORK_TESTS` from `git ls-files '*/fork/*.test.ts' '*/fork/**/*.test.ts'` plus the
  branding tests, and add `apps/server packages/contracts packages/client-runtime` (and
  `apps/mobile` once it has fork code) to `TYPECHECK_DIRS`.
- If any `apps/web/src/routes/*loom*` file exists, regenerate the route tree before the web
  typecheck (see EXTENSION-POINTS.md, Settings).

## Documentation

- The packet folder is the design record: `PRODUCT.md` for intent, `TECHNICAL.md` for the
  design, `SEAMS.md` for every upstream touch. Keep them accurate as the code changes and
  trim them once the packet is done; do not append a history.
- User-facing help for a fork feature goes in `docs/fork/user/<slug>.md`, in the product's
  voice, following the `docs/user/` rules in AGENTS.md (what it does, how to start, anything
  unintuitive). Do not edit upstream `docs/user/` pages; that would add merge conflicts.
- Internal constraints that span packets belong in EXTENSION-POINTS.md, not in a packet.
- Do not edit upstream `docs/internals/`. If upstream guidance becomes wrong for Loom, note
  it in FORK.md.
- No emojis and no em dashes in docs or product copy.

## Surfaces

Default policy for every packet, unless its `PRODUCT.md` says otherwise:

- Web and desktop: required. Desktop loads the same web bundle, so a web feature is a
  desktop feature; Electron-only work (native dialogs, windows) uses the desktop extension
  point and degrades to "not available in the browser" on web.
- Mobile: optional. Mobile uses the same `client-runtime`, so fork RPCs and atoms are
  available to it for free; mobile UI needs its own seams and is its own decision.
- Remote: required. Everything goes over the environment's WebSocket RPC (or `/api/loom/`
  HTTP routes), so it works locally, over Tailscale and through T3 Connect. Never read the
  client's filesystem or credentials for environment work.
- Version skew: a Loom client talking to an upstream T3 server, and an upstream client
  (app.t3.codes, the App Store mobile app) talking to a Loom server, must both keep working.
  Gate fork UI on `capabilities.loomFeatures` and never change upstream wire schemas or
  persisted event types (EXTENSION-POINTS.md, Surfaces and version skew).

State in `PRODUCT.md` which surfaces the packet supports and what each unsupported one shows.

## Definition of done

A packet is done when all of these hold:

1. The behavior in `PRODUCT.md` works on every surface the packet claims, including
   loading, empty and error states, and the reverse of every action (close for open,
   unpin for pin).
2. Every extension point it uses exists exactly as EXTENSION-POINTS.md specifies, created in
   its own commit if this packet created it.
3. All new code is in fork-owned paths; every upstream touch is a marked seam listed in the
   packet's `SEAMS.md` and in FORK.md.
4. Focused tests for the new behavior pass; the changed packages typecheck; lint is clean on
   changed files; `pnpm-lock.yaml` is untouched.
5. The merge preview against the newest nightly is clean or conflicts only on marked seams.
6. The UI degrades gracefully when the server lacks the feature (no `loomFeatures` entry).
7. Performance: no continuously repainting animation, no unbounded subscription payloads, no
   per-keystroke RPC without debounce.
8. `docs/fork/user/<slug>.md` exists if users need to know anything, and the packet's
   Status in the index is updated.
