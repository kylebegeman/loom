# L100 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

None. Every touch is fork code:

- Library routes live in `apps/server/src/fork/bots/botLibraryHttp.ts` and are registered in
  `apps/server/src/fork/ForkLayer.ts` as `BotLibraryHttpRoutes` beside `PageLibraryHttpRoutes`
  and `DirectoryHttpRoutes`.
- The Library client uses `resolveLibraryConnection` and its `send`
  (`apps/server/src/fork/project-library/LibraryConnection.ts`), fork code.
- Vault slots reach the provider as `vaultPromptLink` text, which the existing
  `ext-vault-preflight` guard in `apps/server/src/orchestration-v2/ProviderTurnStartService.ts`
  checks. This packet does not edit it.
- The `computers` tab value is added to the fork route `apps/web/src/routes/loom.bots.tsx`.

## Merge check

Run before each commit:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Recorded when the packet landed: `v0.1.1-nightly.20261020.3411`, 68 conflicting files, the same
68 the branch base already had.

## FORK.md rows

None.

## Where the build differs from the plan

- The Library service, routes and client are `BotLibraryService.ts`, `botLibraryHttp.ts` and
  `BotLibraryClient.ts`; the computer side (sync, status reports, remote runs, Vault bindings) is
  one service, `BotSharing.ts`, which `BotsService` reaches through `setAnywhereHooks`. The
  planned test files became `BotLibraryService.test.ts` (Library) and `BotSharing.test.ts`
  (computers, through an in-process client).
- A remote run and its thread keep the ids the requester chose: the target's run id is the
  request id, and its thread is `botRunThreadId(requestId)`. Both computers name the run alike.
- A remote run uses the Library's revision of the bot. A version pinned on the requesting
  computer is not honored on the target.
- `modelOverride` is kept when a computer saves a linked bot on a model the others may not have,
  and the publish then sends `keepModel`, so the Library keeps the shared model.
- Deleting a linked bot removes only the local copy. Unsharing leaves every copy as an ordinary
  bot rather than deleting it.
- Targets come from the computers' status reports to the Library, not `DirectoryService`.
  Required tools (L73) are not part of readiness, LoomOS machines without a Loom server are not
  listed, and readiness checks that each Vault slot is bound to a readable item rather than that
  the Vault backend is reachable.
- A shared bot's project fields carry its Library project id while in the Library; each
  computer maps it to its own project on pull. A run whose project is not in the Library is
  refused with "Add this project to the Library to run it on other computers."
- A batch stores its target as `target_json`, and `best` is resolved per item. The batch's
  concurrency window stays the bot's own limit on the requesting computer.
- Vault slots are declared in the bot editor and bound per computer in the bot's **Library**
  panel through `VaultReferencePicker`.
- The web hides **Run on** until another computer has reported, and a checkout chosen in the run
  form applies only to runs on this computer.
