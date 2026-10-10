# L17 testing

Focused tests, no repo-wide checks, no sleeps. No test calls a real endpoint; HTTP peers are
fakes.

## Automated tests

| File                                                                  | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/more-providers.test.ts`                  | Tags start with `loom.more-providers.`; `buildEndpointEnvironment` per preset (sensitive token, empty `ANTHROPIC_API_KEY`, placeholders, alias variables); `shareSkillsDefault` is true for DeepSeek and Other and false for Ollama and LM Studio.                                                                                                                                                                                                    |
| `apps/server/src/fork/more-providers/endpoints/SkillsLink.test.ts`    | Temp dir: source resolved from the default Claude instance's `homePath` or `~/.claude`; `none` -> link creates one symlink to the source; `linked` -> unlink removes only the symlink and the source's files remain; a real `skills` directory and a symlink to elsewhere read `own-folder` and refuse both ways; a missing source reads `no-source` and refuses to link; prepare creates `0700`, refuses a non-empty folder and a path outside home. |
| `apps/server/src/fork/more-providers/endpoints/EndpointProbe.test.ts` | Fake `HttpClient`: OpenAI and Ollama model lists; 401 and 404 mapped to key-free messages; timeouts; unknown shapes warn; the key never appears in any returned string; query strings stripped from URLs in errors.                                                                                                                                                                                                                                   |
| `apps/server/src/fork/more-providers/endpoints/EndpointStore.test.ts` | `SqlitePersistenceMemory`: record, list, forget; list drops records for instances missing from settings; migrations run twice without change.                                                                                                                                                                                                                                                                                                         |
| `apps/web/src/fork/more-providers/endpointDialog.logic.test.ts`       | Step validation, default and small model choice, the skills switch default per preset, the provider instance entry written for each preset (driver `claudeAgent`, `homePath`, `customModels`).                                                                                                                                                                                                                                                        |

Registry invariants come from the `ext-core`, settings and palette tests.

## Commands

```sh
vp test run packages/contracts/src/fork/more-providers.test.ts \
  apps/server/src/fork/more-providers \
  apps/server/src/fork/rpcAuthorization.test.ts \
  apps/web/src/fork/more-providers/endpointDialog.logic.test.ts

vp lint packages/contracts/src/fork apps/server/src/fork apps/web/src/fork packages/client-runtime/src/fork

vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
```

## Manual check

With Kyle's permission for a dev server and browser. Worktree `.t3` seeded per AGENTS.md.

1. Ollama (if installed; otherwise LM Studio): pull a tool-capable model with 32K+ context;
   Settings > Loom > Model endpoints > Add endpoint > Ollama; the skills switch is off; Test
   connection lists models; create; the new folder has no `skills`; in a scratch project ask
   it to edit a file; approve; the diff appears. Turn the row's skills switch on: `skills`
   is a symlink to the main Claude skills folder; off: the symlink is gone and the main
   folder is untouched.
2. Optional, only if Kyle wants a live DeepSeek check (he is not setting it up now): same
   flow with his key; the skills switch starts on; confirm the key is shown as "Sensitive"
   in the provider editor and absent from `.t3/userdata/settings.json` in plain text.
   Without it, use the "Other" preset against the local Ollama to exercise the key field
   and the cloud skills default.
3. Refresh models on the endpoint row; the model picker updates.
4. Remote: from a phone paired to the dev server, send a message on the Ollama instance.
5. Upstream server: the Model endpoints section says "Needs a Loom server"; an endpoint
   instance created earlier still works there (it is a plain Claude instance).

## Acceptance criteria

- The model endpoint flows work on web and desktop, locally and remotely.
- No secret in logs or traces during the manual run (grep `.t3/userdata/logs` for the key).

## Merge safety

Merge preview from CONVENTIONS.md on the packet branch, recorded in SEAMS.md; conflicts only
on `fork: ext-*` lines. After Kyle merges, `scripts/fork/loom.sh integrate nightly --dry-run`
from a clean, synced `main`.
