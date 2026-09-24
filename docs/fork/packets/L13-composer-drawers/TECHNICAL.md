# L13 technical design

Citations are to this fork at upstream v0.0.42 (`a931bd85f3`); search for the quoted code
when lines drift.

## Overview

```
ChatComposer (upstream)
  ext-composer footer block  -> <ComposerToolsButton>   (opens drawer, shows "armed" dot)
  ext-composer drawer hook   -> useComposerToolsDrawer   (tabs: Once | Schema | Shell | Clipboard)
                                  |          |         |           |
                        OnceController   insertText  shell RPC   clipboard store (memory,
                        (draft store +   via handle  (fork core)  optional localStorage)
                         thread commands)                           ^
                                                                    |
ForkRoot (ext-web-root) -> ClipboardCapture (copy events, writeText wrapper, focus read)
                        -> OnceRestorer (watches armed threads, restores after the turn)
                        -> command host (loom.composer-drawers.*)
```

Everything is client-side except the Shell tab, which calls one fork RPC.

The drawer's hook runs inside `ChatComposer`, so it can read the composer handle
(`useComposerHandleContext()`, `apps/web/src/composerHandleContext.ts`; the context is
provided by `CommandPalette` at `apps/web/src/components/CommandPalette.tsx:542`, which
wraps the chat view). The handle offers `insertTextAtEnd`, `pasteTextAtEnd`,
`readSnapshot`, `focusAt` and `getSendContext` (`ChatComposerHandle`,
`apps/web/src/components/chat/ChatComposer.tsx:1216-1273`).

## Contracts

`packages/contracts/src/fork/composer-drawers.ts` (the slug is the file name):

```ts
export const COMPOSER_DRAWERS_WS_METHODS = {
  runCommand: "loom.composer-drawers.runCommand",
} as const;

export const COMPOSER_SHELL_LIMITS = {
  commandMax: 4_000,
  outputBytesDefault: 64 * 1024,
  outputBytesMax: 1024 * 1024,
  timeoutMsDefault: 30_000,
  timeoutMsMax: 10 * 60_000,
} as const;

/** The choices the settings page and the Shell tab offer. */
export const COMPOSER_SHELL_TIMEOUT_CHOICES_MS = [
  10_000, 30_000, 60_000, 120_000, 300_000, 600_000,
] as const;
export const COMPOSER_SHELL_OUTPUT_CHOICES_BYTES = [
  64 * 1024,
  256 * 1024,
  512 * 1024,
  1024 * 1024,
] as const;

export const ComposerShellRunInput = Schema.Struct({
  projectId: ProjectId,
  /** Omitted for a thread that has no server record yet; the project root is used. */
  threadId: Schema.optionalKey(ThreadId),
  command: TrimmedNonEmptyString.check(Schema.isMaxLength(COMPOSER_SHELL_LIMITS.commandMax)),
  timeoutMs: Schema.Int.check(
    Schema.isBetween({ minimum: 1_000, maximum: COMPOSER_SHELL_LIMITS.timeoutMsMax }),
  ),
  /** Per stream (stdout and stderr each). The server rejects anything over 1 MB. */
  maxOutputBytes: Schema.Int.check(
    Schema.isBetween({ minimum: 1_024, maximum: COMPOSER_SHELL_LIMITS.outputBytesMax }),
  ),
});

export const ComposerShellRunResult = Schema.Struct({
  cwd: Schema.String,
  exitCode: Schema.NullOr(Schema.Int),
  timedOut: Schema.Boolean,
  durationMs: NonNegativeInt,
  stdout: Schema.String,
  stderr: Schema.String,
  truncated: Schema.Boolean,
});

export class ComposerShellError extends Schema.TaggedError<ComposerShellError>()(
  "ComposerShellError",
  {
    reason: Schema.Literals(["no-workspace", "spawn-failed", "unknown-project", "unknown-thread"]),
    message: Schema.String,
  },
) {}

const ComposerShellRunRpc = Rpc.make(COMPOSER_DRAWERS_WS_METHODS.runCommand, {
  payload: ComposerShellRunInput,
  success: ComposerShellRunResult,
  error: Schema.Union([ComposerShellError, EnvironmentAuthorizationError]),
});

export const ComposerDrawersRpcGroup = RpcGroup.make(ComposerShellRunRpc);
```

Scope in `FORK_RPC_REQUIRED_SCOPES`: `terminal:operate` (`AuthTerminalOperateScope`,
`packages/contracts/src/auth.ts:83`), because it runs arbitrary commands like a terminal.
Unary, so no stream-union change.

## Server

`apps/server/src/fork/composer-drawers/`:

| File                  | Contents                                                                            |
| --------------------- | ----------------------------------------------------------------------------------- |
| `ShellRunner.ts`      | `ComposerShellRunner` service: resolves the working directory and runs the command. |
| `ShellRunner.test.ts` | Tests (TESTING.md).                                                                 |
| `rpc.ts`              | `makeComposerDrawersRpcHandlers(auth)`.                                             |

Registrations: `ComposerShellRunner.layer` in `ForkServicesLive`, the service in
`ForkServices`, `"composer-drawers"` in `LOOM_SERVER_FEATURES`, handlers in
`ForkRpcGroup.of`, the scope.

### Working directory

1. With `threadId`: `ProjectionSnapshotQuery.getThreadShellById(threadId)`
   (`apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:217-219`). Use its
   `worktreePath` when set; fail `unknown-thread` when absent or when its `projectId`
   differs from the input.
2. Otherwise, or when `worktreePath` is null:
   `ProjectionSnapshotQuery.getProjectShellById(projectId)` (line 174) and its workspace
   root. Fail `unknown-project` when absent, `no-workspace` when it has no root.
3. Check the directory exists (`FileSystem.stat`); fail `no-workspace` if not.

### Running

Use upstream's `ProcessRunner` (`apps/server/src/processRunner.ts:140-145`). It is not in
the global context (upstream provides `ProcessRunner.layer` to the layers that use it,
`apps/server/src/server.ts:326,392,407`), so provide it to this service's layer:
`ComposerShellRunner.layer.pipe(Layer.provide(ProcessRunner.layer))`. It is stateless;
another instance is harmless (unlike the stateful layers EXTENSION-POINTS.md warns about).

```ts
const shell =
  process.platform === "win32"
    ? { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", input.command] }
    : { command: process.env.SHELL ?? "/bin/sh", args: ["-lc", input.command] };

const output =
  yield *
  runner.run({
    ...shell,
    cwd,
    timeout: Duration.millis(input.timeoutMs),
    maxOutputBytes: input.maxOutputBytes,
    outputMode: "truncate",
    truncatedMarker: "\n[output truncated]\n",
    timeoutBehavior: "timedOutResult",
    env: { ...process.env, T3CODE_LOOM_SHELL: "1" },
  });
```

- `-lc` gives the user's login `PATH` (the environment the terminal would have). Upstream's
  terminal resolves the shell the same way (`apps/server/src/terminal/Manager.ts:468-472`).
- `ProcessRunInput` fields used: `timeout`, `maxOutputBytes`, `outputMode: "truncate"`,
  `truncatedMarker`, `timeoutBehavior: "timedOutResult"` (`processRunner.ts:20-36`). A
  timed-out run returns no partial output (documented at line 32-34); the UI says so.
- `maxOutputBytes` applies to stdout and stderr separately (the runner collects each
  stream with the same limit, `processRunner.ts:356,367`), so one run returns at most twice
  the limit plus the markers. `truncated` is `stdoutTruncated || stderrTruncated`.
- Limits are enforced by the input schema, not by trusting the client's settings: a
  client cannot ask for more than 10 minutes or 1 MB per stream.
- `stdin` is empty; interactive commands get EOF and usually exit.
- Map `ProcessSpawnError` to `ComposerShellError` `spawn-failed`; other runner errors to
  the same with their message. Log the command at debug level only (commands can contain
  secrets).
- No approval flow: the user typed and ran the command in their own session with the
  `terminal:operate` scope.

## Storage

No server storage. Client storage (all through `resolveStorage`, wrapped in try/catch):

| Key                                           | Value                                                   |
| --------------------------------------------- | ------------------------------------------------------- |
| `loom:composer-drawers:last-tab:v1`           | `"once" \| "schema" \| "shell" \| "clipboard"`          |
| `loom:composer-drawers:schemas:v1`            | up to 10 `{ id, name, schema: string, updatedAt }`      |
| `loom:composer-drawers:shell-recent:v1`       | up to 20 recent commands (strings, newest first)        |
| `loom:composer-drawers:once:v1`               | armed and restoring records, below                      |
| `loom:composer-drawers:clipboard-settings:v1` | `{ enabled: false, persist: false, readOnFocus: true }` |
| `loom:composer-drawers:shell-settings:v1`     | `{ timeoutMs: 30000, maxOutputBytes: 65536 }`           |
| `loom:composer-drawers:clipboard:v1`          | entries, only when `persist` is on                      |

Shell history can contain secrets typed on the command line; it is per client, capped, and
"Clear clipboard history" in settings has a sibling "Clear recent commands".

## Clients

`apps/web/src/fork/composer-drawers/`:

| File                         | Purpose                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `registry.ts`                | `composerToolsBlock` (footer block) and `composerToolsDrawer` (drawer) definitions for ext-composer. |
| `drawerStore.ts`             | Zustand: `{ openThreadKey: string \| null, tab }`, `open(threadKey, tab)`, `close()`, `toggle`.      |
| `ComposerToolsDrawer.tsx`    | Drawer frame (header, tabs, Escape to close).                                                        |
| `OnceTab.tsx`, `once.ts`     | Once UI and controller (snapshot, restore).                                                          |
| `OnceRestorer.tsx`           | `ForkRoot` component: restores thread settings after an armed turn.                                  |
| `SchemaTab.tsx`, `schema.ts` | Schema UI; pure `formatSchemaInstruction`, `validateSchemaText`.                                     |
| `ShellTab.tsx`, `shell.ts`   | Shell UI; pure `formatShellAttachment`.                                                              |
| `ClipboardTab.tsx`           | List, insert, delete, clear.                                                                         |
| `clipboard.ts`               | Store, limits, dedupe, persistence toggle.                                                           |
| `clipboardFilter.ts`         | `isSensitiveClipboardText(text)`.                                                                    |
| `ClipboardCapture.tsx`       | `ForkRoot` component: capture sources.                                                               |
| `state.ts`                   | `composerDrawersEnvironment` RPC command atom (`createEnvironmentRpcCommand`).                       |
| `settings.tsx`               | Loom settings section "Composer drawers".                                                            |
| `palette.tsx`, `commands.ts` | Palette source; `onForkCommand` handlers.                                                            |

Client-runtime: `packages/client-runtime/src/fork/composer-drawers.ts` exports
`createComposerDrawersEnvironmentAtoms(runtime)` with one command atom for `runCommand`,
so mobile could use it later.

### Footer block and drawer (ext-composer)

- Block `id: "composer-tools"`: an icon button (lucide `Wrench`), `size` from props, with
  a dot when Once is armed for this thread. Tooltip "Composer tools". Clicking toggles the
  drawer for `scopedThreadKey(threadRef)`.
- Drawer `id: "composer-tools"`: `useDrawer({ environmentId, threadRef, replace })` reads
  `drawerStore`; returns `null` unless `openThreadKey` equals this thread's key. Returns the
  drawer element otherwise. It also reads `useComposerHandleContext()` and passes the
  handle down.
- The ext-composer host hides fork drawers while the stash menu, an upstream trigger menu,
  or an approval is showing; the drawer store stays open, so it reappears after.
- Escape closes (listener on the drawer element, capture phase like
  `ComposerStashMenu`'s window listener at `ComposerStashMenu.tsx:34-40` comment).

### Once

Snapshot on arm (server threads only, and only when the thread is idle):

```ts
interface OnceSnapshot {
  readonly threadKey: string;
  readonly armedAt: string; // ISO
  readonly draft: Pick<
    ComposerThreadDraftState,
    "modelSelectionByProvider" | "activeProvider" | "modelSelectionExplicit" | "runtimeMode"
  >;
  readonly sticky: {
    readonly stickyModelSelectionByProvider: ComposerDraftStoreState["stickyModelSelectionByProvider"];
    readonly stickyActiveProvider: ProviderInstanceId | null;
  };
  /** What the server thread had; restored after the turn when still overridden. */
  readonly thread: { readonly modelSelection: ModelSelection; readonly runtimeMode: RuntimeMode };
}
```

- Draft fields come from `useComposerDraftStore.getState().getComposerDraft(threadRef)`
  (`apps/web/src/composerDraftStore.ts:491`); the fields are declared in
  `ComposerThreadDraftState` (378-405). Sticky fields are store state (488-489); they
  matter because upstream's model picker also updates the sticky selection used for new
  threads (`ChatView.tsx:8895-8900`).
- Thread fields come from `useThreadShell(threadRef)` (`apps/web/src/state/entities.ts:99`;
  shell fields at `packages/contracts/src/orchestration.ts:815-852`).

Restore the composer when a send is observed: the thread shell's `latestUserMessageAt`
becomes later than `armedAt`. Write the snapshot back with one `setState` that replaces only
those four draft fields for that thread key and the two sticky fields. This couples to the
store's state shape (typed through `ComposerThreadDraftState`, so a rename fails typecheck);
the public setters cannot restore `modelSelectionExplicit` or remove sticky entries.
Record `{ sentAt: latestUserMessageAt }` in the Once record and move it to "restoring".

Restore the thread after the turn: `OnceRestorer` (mounted in `ForkRoot`, so it works
even if the user navigates away) watches restoring records' thread shells. When
`latestTurn` exists with `requestedAt >= sentAt` and `state` is not `"running"`, compare
the shell's `modelSelection` and `runtimeMode` with the snapshot's `thread` values; for each
that differs, dispatch the same commands upstream uses before a send
(`persistThreadSettingsForNextTurn`, `ChatView.tsx:5129-5200`): `threadEnvironment.updateMetadata`
with `{ threadId, modelSelection }` and `threadEnvironment.setRuntimeMode` with
`{ threadId, runtimeMode, createdAt }` (atoms used at `ChatView.tsx:1481-1487`). Then delete
the record. On failure, toast and delete the record (never retry in a loop).

Why restore the thread too: turns started without the composer use the thread's stored
settings, for example answering an async question (`decider.ts` builds that turn with
`runtimeMode: thread.runtimeMode`, around line 1683). Without this, an override meant for
one message would leak into those turns.

Records persist in localStorage so a reload between send and turn end still restores. A
record older than 24 hours is dropped on load.

Cancel before sending: restore the composer from the snapshot and delete the record.

### Schema

- `validateSchemaText(text)`: `JSON.parse`; must be an object or a boolean; returns the
  pretty-printed text (2 spaces) or an error message with line and column when the engine
  provides them.
- "Add to prompt": `handle.insertTextAtEnd(formatSchemaInstruction(pretty), { ensureLeadingBoundary: true })`
  where the text is:

  ````
  Respond with only JSON that matches this JSON Schema:

  ```json
  { ... }
  ```
  ````

- Saved schemas: name (default: the schema's `title` or "Schema N"), stored per client.

### Shell

- Input: single-line or multi-line textarea (mod+Enter runs); up and down arrows on an
  empty input walk the recent commands.
- Running: `useAtomCommand(composerDrawersEnvironment.runCommand)` with
  `{ projectId, threadId, command, timeoutMs, maxOutputBytes }`; the project id comes from
  the thread shell (or draft thread context), `threadId` only for server threads.
  `timeoutMs` is the tab's select (preselected from the shell settings, changeable per
  run); `maxOutputBytes` comes from the shell settings. Stored values that are not one of
  the `COMPOSER_SHELL_*_CHOICES` fall back to the defaults when read.
- The elapsed-seconds counter updates once per second while a run is in flight (a text
  update, not an animation), and stops when the run settles.
- Result preview: exit code, duration, cwd, and the first 200 lines of combined output in
  a `pre` with its own scroll area.
- `formatShellAttachment(result, command)` builds:

  ````
  `$ git status --short` exited with 0 in 0.2 s (cwd: ~/proj)

  ```text
  <stdout>
  <stderr, if any, after a line "stderr:">
  ```
  ````

  with backtick fences lengthened when the output contains ` ``` `.

- "Attach" inserts it with `insertTextAtEnd(..., { ensureLeadingBoundary: true })`. Large
  outputs go through `pasteTextAtEnd` instead, so upstream's large-paste folding applies
  (`ChatComposerHandle.pasteTextAtEnd`, `ChatComposer.tsx:1228-1229`). "Large" means at or
  over upstream's `PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES` (32 KB,
  `packages/client-runtime/src/textPaste.ts:1`, exported as
  `@t3tools/client-runtime/text-paste`), measured in UTF-8 bytes.
- Gating: `supportsLoomFeature(capabilities, "composer-drawers")` for the thread's
  environment; otherwise the tab shows the unavailable message.

### Clipboard

Capture sources, active only while `enabled`:

1. In-app `copy` events: a `document` listener reads `window.getSelection()?.toString()`
   (the event's `clipboardData` is empty on the way out). Skips events whose target is
   inside an `input[type=password]`.
2. In-app programmatic copies: upstream's copy buttons call
   `navigator.clipboard.writeText` (for example `MarkdownCodeBlock` in
   `apps/web/src/components/ChatMarkdown.tsx:929-955`). `ClipboardCapture` wraps
   `navigator.clipboard.writeText` once while enabled (restores the original when
   disabled or unmounted), records the text, then calls through. The wrapper never changes
   the result or timing of the original call.
3. Desktop only (`isElectron`, `apps/web/src/env.ts`), when `readOnFocus`: on the window
   `focus` event, `navigator.clipboard.readText()`; ignore failures silently. Electron grants
   clipboard reads to the app's own window when no permission handler denies them (the
   desktop app sets permission handlers only for preview browser sessions,
   `apps/desktop/src/preview/BrowserSession.ts`); verify this on the first run and, if it
   is denied, drop source 3 and note it in the user doc.

Filters (before storing), in `clipboardFilter.ts`:

- Empty or whitespace-only, or over 20,000 characters: skip.
- Sensitive-looking text: private key blocks (`-----BEGIN [A-Z ]*PRIVATE KEY-----`),
  well-known token prefixes (`ghp_`, `gho_`, `github_pat_`, `glpat-`, `sk-`, `sk-ant-`,
  `xox[abpr]-`, `AKIA[0-9A-Z]{16}`, `AIza[0-9A-Za-z_-]{35}`), JWTs
  (`^eyJ[\w-]+\.[\w-]+\.[\w-]+$`), `password|passwd|secret|token|api[_-]?key` followed by
  `=` or `:` and a value, and a single "word" of 24 or more characters with no spaces that
  mixes at least three of lowercase, uppercase, digits and symbols (likely a generated
  password). False positives are acceptable; false negatives are the risk, so the list
  errs on the side of skipping.

Store rules: newest first; at most 30 entries; entries older than 24 hours are dropped on
read; a new entry equal to an existing one moves it to the top; in memory unless
`persist` is on. Turning the feature off clears memory and the persisted key.

Insert at the caret (entries are capped at 20,000 characters, below upstream's 32 KB
large-paste threshold, so folding never applies): read `handle.readSnapshot()`;
`replace(expandedCursor, expandedCursor, text, { expectedText: "" })` from the drawer's
`replace` prop. If `replace` returns false, fall back to `insertTextAtEnd`. (Verify during implementation that `applyPromptReplacement` uses
expanded-cursor offsets, as `resolveActiveComposerTrigger` at `ChatComposer.tsx:3501-3510`
suggests; if not, always append.)

### Settings (ext-settings)

Section id `composer-drawers`, title "Composer drawers":

- "Clipboard history": switch, off by default. Description: "Remember text you copy so you
  can insert it later. Stored on this device only. Text that looks like a password or key
  is skipped."
- "Keep across restarts": switch, off, disabled while history is off.
- "Read the clipboard when Loom is focused": switch, on, desktop only (hidden on web).
- "Default timeout": select over `COMPOSER_SHELL_TIMEOUT_CHOICES_MS` ("10 s" to "10 min"),
  default 30 s.
- "Output limit": select over `COMPOSER_SHELL_OUTPUT_CHOICES_BYTES` ("64 KB" to "1 MB"),
  default 64 KB.
- Buttons: "Clear clipboard history", "Clear recent commands".

Client preferences only, so the section works with any environment selected.

### Keybindings and palette

- `FORK_KEYBINDING_COMMANDS` gains `loom.composer-drawers.tools`,
  `loom.composer-drawers.once`, `loom.composer-drawers.shell`,
  `loom.composer-drawers.clipboard`. Handlers (`commands.ts`, subscribed from a `ForkRoot`
  component) act on the active thread (`useHandleNewThread().activeThread`).
- Palette items (`action:loom:composer-drawers:<name>`): "Composer tools", "Next message
  only", "Run a shell command for the prompt" (hidden when the environment lacks
  `composer-drawers`), "Clipboard history", "Clear clipboard history". Only with an active
  thread, except "Clear clipboard history".

## Agent-facing tools

None.

## Performance

- Nothing renders while the drawer is closed except the footer button.
- `OnceRestorer` subscribes to thread shells only for threads with a record (usually none).
- Clipboard capture adds one `copy` listener and one `focus` listener while enabled, no
  timers and no polling.
- The shell RPC runs only when the user presses Run and returns at most the output limit
  per stream: 64 KB by default, 1 MB per stream when the user raises it. The preview
  renders only the first 200 lines; attaching a large result goes through upstream's
  large-paste folding.

## Alternatives considered

- Per-turn overrides as new fields on `thread.turn.start` (old Loom's `perTurnOverrides`):
  needs changes to upstream's command contract, decider and adapters. Rejected; the Once
  approach uses upstream's own pickers and commands.
- Native Codex shell command (`thread/shellCommand`, old Loom): provider-specific and
  bypasses the prompt; rejected for a provider-neutral RPC.
- Polling the clipboard from Electron's main process every 1.5 s (old Loom,
  `apps/desktop/src/clipboard/ClipboardHistory.ts`): captures copies from other apps while
  Loom is in the background and can honor macOS `org.nspasteboard.ConcealedType`, but needs
  the `ext-desktop` extension point (EXTENSION-POINTS.md section 13) and a desktop-only
  collector. Follow-up by Kyle's decision (focus-regain capture is enough for v1); it can be
  added later without changing the store.
- Native structured output (Codex `outputSchema`, Claude structured output): follow-up by
  Kyle's decision, pending verification of what each SDK accepts. It needs an optional field
  on upstream's `thread.turn.start` and adapter seams, so it belongs to a provider-seam
  packet.
- Sending clipboard text to Jev for secret detection: rejected, because it would send the
  clipboard to a third party. The local regex filter stays.
- A terminal-context chip for shell output (`handle.addTerminalContext`): renders nicely,
  but the chip points at a terminal id that does not exist; a fenced block is honest and
  works in every provider.
