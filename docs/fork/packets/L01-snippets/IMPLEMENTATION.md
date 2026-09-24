# L01 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling. Three phases; each ends
in a usable state and can be reviewed on its own.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. Work in a worktree. Seed the worktree's `.t3` with a `VACUUM INTO` copy of real
data (AGENTS.md, "Test data") so projects and threads exist for manual checks. Do not
start dev servers or browsers without Kyle's permission.

## File layout

```
packages/contracts/src/fork/snippets.ts
packages/client-runtime/src/fork/snippets.ts
packages/client-runtime/src/fork/snippetsEngine.ts
packages/client-runtime/src/fork/snippetsEngine.test.ts
apps/server/src/fork/snippets/migrations.ts
apps/server/src/fork/snippets/SnippetStore.ts
apps/server/src/fork/snippets/SnippetService.ts
apps/server/src/fork/snippets/SnippetService.test.ts
apps/server/src/fork/snippets/rpc.ts
apps/web/src/fork/snippets/state.ts
apps/web/src/fork/snippets/readLibrary.ts
apps/web/src/fork/snippets/panel.tsx
apps/web/src/fork/snippets/SnippetsPanel.tsx
apps/web/src/fork/snippets/SnippetEditor.tsx
apps/web/src/fork/snippets/SnippetSearchDialog.tsx
apps/web/src/fork/snippets/SnippetSearchHost.tsx
apps/web/src/fork/snippets/composerBridge.ts
apps/web/src/fork/snippets/fillInDrawer.tsx
apps/web/src/fork/snippets/fillInStore.ts
apps/web/src/fork/snippets/composerMenu.ts
apps/web/src/fork/snippets/terminalSend.ts
apps/web/src/fork/snippets/terminalSend.test.ts
apps/web/src/fork/snippets/palette.tsx
apps/web/src/fork/snippets/commands.ts
docs/fork/user/snippets.md
```

## Phase 1: library, panel, search dialog

1. Extension points: run the existence checks for `ext-core`, `ext-panels`,
   `ext-web-root`, `ext-keybindings`, `ext-palette`. Create any missing one exactly as
   specified, one commit each (`feat(fork): add the <name> extension point`), with its
   FORK.md rows. Run that extension point's own tests and typechecks.
2. Contracts: write `packages/contracts/src/fork/snippets.ts` from TECHNICAL.md. Export it
   from `fork/index.ts`, merge `SnippetsRpcGroup` in `fork/rpc.ts`, set
   `ForkSubscriptionRpcTag`. Typecheck `@t3tools/contracts`.
3. Engine: `snippetsEngine.ts` with `parseSnippetFields`, `expandSnippet`, `rankSnippets`,
   `findExactAlias`, `parseSnippetArtifacts`, `buildSnippetArtifact`,
   `convertLegacyBraces`, plus the test file (TESTING.md lists cases). Test-first here:
   these are pure and carry most of the subtle behavior.
4. Server:
   - `migrations.ts` (migration 1, DDL from TECHNICAL.md), added to `FORK_MIGRATION_SETS`.
   - `SnippetStore.ts`: SQL only. Use `SqlClient` tagged templates and `sql.withTransaction`.
   - `SnippetService.ts`: rules from TECHNICAL.md. Publish snapshots through a
     `PubSub.unbounded<SnippetLibrary>()`; build the subscribe stream like
     `DeviceService.stateStream` (`apps/server/src/device/DeviceService.ts:1026-1035`).
     Run the 30-day purge once in the layer after construction.
   - `rpc.ts`: handlers; add scopes to `FORK_RPC_REQUIRED_SCOPES`; spread into
     `ForkRpcGroup.of`.
   - Register the layer in `ForkServicesLive`, the service in `ForkServices`, and
     `"snippets"` in `LOOM_SERVER_FEATURES`.
   - `SnippetService.test.ts` on `SqlitePersistenceMemory`.
5. Client-runtime atoms: `createSnippetsEnvironmentAtoms(runtime)`; export from
   `client-runtime/src/fork/index.ts`. Typecheck `@t3tools/client-runtime`.
6. Web state: `state.ts`, `readLibrary.ts`. For `readLibrary`, read the subscription
   atom's current value from `appAtomRegistry` (`apps/web/src/rpc/atomRegistry`) without
   mounting it; the panel, dialog or composer bridge keep it mounted.
7. Panel: `panel.tsx` (id `snippets`, letter `S` as assigned in
   EXTENSION-POINTS.md, "Launcher letters"), `SnippetsPanel.tsx`
   and `SnippetEditor.tsx`. Views: list (filters All, Pinned, This project, Deleted),
   detail, edit or create, history. Unknown-project group with "Make global". Append to
   `FORK_PANELS`.
8. Search dialog and host: `SnippetSearchDialog.tsx`, `SnippetSearchHost.tsx` (append to
   `FORK_ROOT_COMPONENTS`). In phase 1, Insert uses `insertTextAtEnd` through the composer
   handle only when the composer bridge exists; fields are expanded with defaults (the
   drawer arrives in phase 2).
9. Keybindings and palette: add the two commands to `FORK_KEYBINDING_COMMANDS`,
   `commands.ts`, `palette.tsx` (search, open panel; the insert submenu arrives with the
   bridge in phase 2). Append the source.
10. Checks: tests, lint, typecheck for contracts, client-runtime, server, web
    (TESTING.md). Commit `feat(fork-snippets): keep a snippet library with a panel and search`.

## Phase 2: composer integration

11. Extension points: existence checks for `ext-composer` and `ext-composer-menu`; create
    if missing (see SEAMS.md about writing ext-composer-menu's code into
    EXTENSION-POINTS.md).
12. `composerBridge.ts` and `fillInDrawer.tsx` + `fillInStore.ts`: register the drawer in
    `FORK_COMPOSER_DRAWERS`. The drawer hook always sets the bridge and returns content only
    while a request is pending for its thread.
13. `composerMenu.ts`: the `;` trigger; register in `FORK_COMPOSER_TRIGGERS`.
14. Dialog and palette: switch insertion to the bridge's caret path (TECHNICAL.md, "The
    composer bridge"), add the Insert submenu and "Save prompt as snippet".
15. Checks. Commit `feat(fork-snippets): insert snippets from the composer with ;alias`.

## Phase 3: history, import and export, terminal

16. History view and restore (with the alias-conflict retry). Soft delete, Deleted filter,
    restore and purge.
17. Import dialog: file input (`accept=".md,.json,text/markdown"`), parse with
    `parseSnippetArtifacts`, show a preview list with warnings and a project picker, then
    call `loom.snippets.import`. Export one and export all.
18. `terminalSend.ts` and its test (target resolution and bracketed-paste wrapping).
19. `docs/fork/user/snippets.md`: what snippets are, `;alias`, fields syntax, suggested
    keybindings, import from old Loom, the terminal caveat.
20. Update the packet index Status. Checks. Commit
    `feat(fork-snippets): restore history, import and export, and send to terminal`.

## Code sketches

Service skeleton:

```ts
export class SnippetService extends Context.Service<
  SnippetService,
  {
    readonly library: Effect.Effect<SnippetLibrary, SnippetStorageError>;
    readonly changes: Stream.Stream<SnippetLibrary>;
    readonly upsert: (input: SnippetUpsertInput) => Effect.Effect<Snippet, SnippetsServiceError>;
    // setPinned, delete, restoreDeleted, purge, revisions, restoreRevision, recordUse, importMany
  }
>()("loom/snippets/SnippetService") {}

export const layer = Layer.effect(
  SnippetService,
  Effect.gen(function* () {
    const store = yield* SnippetStore;
    const pubsub = yield* PubSub.unbounded<SnippetLibrary>();
    const version = yield* Ref.make(0);
    yield* store.purgeDeletedBefore(daysAgo(SNIPPET_LIMITS.deletedRetentionDays));
    const publish = Effect.gen(function* () {
      const next = yield* Ref.updateAndGet(version, (n) => n + 1);
      const snapshot = yield* store.readLibrary(next);
      yield* PubSub.publish(pubsub, snapshot);
    });
    // ...operations call `publish` after their transaction commits
  }),
).pipe(Layer.provide(SnippetStore.layer));
```

Handler shape:

```ts
export const makeSnippetsRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.succeed(
    SnippetsRpcGroup.of({
      [SNIPPETS_WS_METHODS.subscribe]: () =>
        auth.stream(
          SNIPPETS_WS_METHODS.subscribe,
          Stream.unwrap(withForkRuntime(Effect.map(SnippetService, (s) => s.changesWithInitial))),
        ),
      [SNIPPETS_WS_METHODS.upsert]: (input) =>
        auth.effect(
          SNIPPETS_WS_METHODS.upsert,
          withForkRuntime(Effect.flatMap(SnippetService, (s) => s.upsert(input))),
        ),
      // ...
    }),
  );
```

Fill-in drawer registration:

```tsx
export const snippetsFillInDrawer: ForkComposerDrawer = {
  id: "snippets-fill-in",
  useDrawer: ({ environmentId, threadRef, replace }) => {
    const handle = useComposerHandleContext();
    useEffect(() => {
      const bridge = { threadRef, replace, handle };
      setSnippetsComposerBridge(bridge);
      return () => clearSnippetsComposerBridge(bridge);
    }, [threadRef, replace, handle]);
    const pending = useFillInStore((s) => s.byThreadKey[scopedThreadKey(threadRef)] ?? null);
    if (!pending || !supportsSnippets(environmentId)) return null;
    return <FillInDrawer request={pending} replace={replace} />;
  },
};
```

## Pitfalls

- `RpcGroup.merge` silently replaces duplicate tags. Keep every tag `loom.snippets.*`.
- A streaming tag missing from `ForkSubscriptionRpcTag` is typed as unary and breaks the
  subscription atom at compile time only in subtle ways; add it in step 2.
- Do not decode rows with `Schema.Unknown` casts; decode `tags_json`, `aliases_json` and
  `content_json` with their schemas and map failures to `SnippetStorageError`.
- `applyPromptReplacement` offsets: verify expanded-cursor coordinates before relying on
  caret insertion (TECHNICAL.md).
- The drawer hook runs on every composer render; keep it cheap (one selector, one effect).
- Aliases are matched case-insensitively but displayed as typed; never lowercase stored
  display values.
- The ext-composer-menu trigger must return `null` fast when unsupported, or it would
  shadow nothing but still cost a regex per keystroke; that is fine, but never read the
  atom registry in `detect` beyond one map lookup.
- Old Loom lessons to avoid: swallowing Tab on no match, two server round trips per
  expansion, revision spam on unchanged saves, history lost on delete, pins in
  localStorage.
- Never commit `pnpm-lock.yaml` (this packet adds no dependency).

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Typing `;` + an alias's first letters shows the snippet within one frame of the
  keystroke on a library of 500 snippets.
- Old Loom `.loom-snippet.md` exports import with fields converted.
- A second client sees an edit without reloading.
