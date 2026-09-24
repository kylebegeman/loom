# L27 technical design

All citations are to this fork at upstream v0.0.42 (commit `a931bd85f3`). Search for the
quoted code when line numbers drift.

## Overview

A client-only feature in `apps/web/src/fork/utilities/`:

```
tools/*.ts        pure functions, one file per category, no React
registry.ts       UTILITY_TOOLS: ReadonlyArray<UtilityTool>, search
store.ts          tiny zustand store: selected tool, dialog open, per-tool drafts (memory only)
UtilitiesView.tsx search + list + tool view (shared by panel and dialog)
ToolView.tsx      renders a tool from its definition: input, options, outputs
panel.tsx         ForkPanelDefinition "utilities"
UtilitiesDialogHost.tsx  ForkRoot component: dialog + loom.utilities.open listener
palette.tsx       "Utilities..." submenu source
```

No contracts, no server, no client-runtime atoms, no `loomFeatures` entry. Because it never
talks to the server, it works on upstream T3 servers too.

## Secure-context constraint

`crypto.subtle` and `crypto.randomUUID` exist only in secure contexts (HTTPS, or
`http://localhost`). A browser reaching a Loom server over the tailnet at `http://100.x.y.z`
is not a secure context, and AGENTS.md makes remote browsers a first-class case. So:

- Hashes and HMAC use `@noble/hashes` (synchronous, pure JS): `sha256`, `sha384`, `sha512`
  from `@noble/hashes/sha2`, `md5` and `sha1` from `@noble/hashes/legacy`, `hmac` from
  `@noble/hashes/hmac`. The catalog pins `@noble/hashes` 1.8.0 (`pnpm-workspace.yaml:42`);
  `legacy.d.ts` there exports `sha1` and `md5`. `apps/web/src/openVsxThemes.ts:1` already
  imports `sha256` from `@noble/hashes/sha2`.
- Random values come from `crypto.getRandomValues`, available in every context. UUID v4 is
  built from 16 random bytes with the version and variant bits set, not `randomUUID`.

## The tools

26 tools. "Lib" is what the implementation uses; every one is already a dependency of
`apps/web` (`apps/web/package.json` dependencies) or a platform API.

| #   | Id            | Label                 | Category | Behavior                                                                                                                                                                                     | Lib                                                                                                                                                                                                        |
| --- | ------------- | --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `base64`      | Base64                | encode   | Encode or decode UTF-8 text; URL-safe alphabet and padding options; decode accepts both alphabets and missing padding                                                                        | `TextEncoder`, `TextDecoder` (`fatal: true` to report invalid UTF-8)                                                                                                                                       |
| 2   | `url`         | URL encode            | encode   | Encode or decode a component (`encodeURIComponent`) or a whole URL (`encodeURI`)                                                                                                             | platform                                                                                                                                                                                                   |
| 3   | `html`        | HTML entities         | encode   | Escape `& < > " '`; decode named (a fixed table of the common 30) and numeric entities                                                                                                       | hand-written                                                                                                                                                                                               |
| 4   | `json-string` | String escape         | encode   | Escape or unescape a JSON string literal                                                                                                                                                     | `JSON.stringify` / `JSON.parse`                                                                                                                                                                            |
| 5   | `basic-auth`  | Basic auth header     | encode   | `user` + `password` to `Authorization: Basic ...` and back                                                                                                                                   | base64 tool                                                                                                                                                                                                |
| 6   | `jwt`         | JWT decode            | encode   | Header and payload as formatted JSON; `exp`, `iat`, `nbf` as ISO and local time with "expired" flag; warning that the signature is not verified                                              | `jose` `decodeJwt`, `decodeProtectedHeader`                                                                                                                                                                |
| 7   | `hash`        | Hash                  | hash     | MD5, SHA-1, SHA-256, SHA-384, SHA-512 of the UTF-8 input; hex or base64; all algorithms at once in a list                                                                                    | `@noble/hashes`                                                                                                                                                                                            |
| 8   | `hmac`        | HMAC                  | hash     | Key and message; SHA-1, SHA-256, SHA-384, SHA-512; key as UTF-8, hex or base64                                                                                                               | `@noble/hashes/hmac`                                                                                                                                                                                       |
| 9   | `uuid`        | UUID                  | generate | v4 and v7; count 1 to 100; uppercase option; also validates and reports the version of a pasted UUID                                                                                         | `getRandomValues`, `Date.now`                                                                                                                                                                              |
| 10  | `ulid`        | ULID                  | generate | Crockford base32, 48-bit time plus 80 random bits; count; decode a ULID's timestamp                                                                                                          | hand-written                                                                                                                                                                                               |
| 11  | `password`    | Password              | generate | Length 8 to 128; lowercase, uppercase, digits, symbols; exclude look-alikes; unbiased by rejection sampling; entropy estimate in bits                                                        | `getRandomValues`                                                                                                                                                                                          |
| 12  | `token`       | Random token          | generate | N bytes (8 to 256) as hex, base64, or base64url                                                                                                                                              | `getRandomValues`                                                                                                                                                                                          |
| 13  | `lorem`       | Lorem ipsum           | generate | Paragraphs, sentences or words from a fixed word list                                                                                                                                        | hand-written                                                                                                                                                                                               |
| 14  | `number-base` | Number base           | convert  | Binary, octal, decimal, hex (and any base 2 to 36), with `0x` / `0b` / `0o` prefixes, big integers                                                                                           | `BigInt`                                                                                                                                                                                                   |
| 15  | `timestamp`   | Unix time             | convert  | Seconds or milliseconds to ISO 8601 UTC, local time and relative time; ISO or `now` back to seconds and milliseconds                                                                         | `Date`, `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`                                                                                                                                                   |
| 16  | `color`       | Color                 | convert  | Any CSS color to hex, RGB, HSL, OKLCH; alpha kept; a swatch                                                                                                                                  | `culori/fn` (`parse`, `converter`, `formatHex8`, `formatRgb`, `formatHsl`), as `apps/web/src/themePalette.ts:4` imports it                                                                                 |
| 17  | `case`        | Case                  | convert  | camelCase, PascalCase, snake_case, CONSTANT_CASE, kebab-case, Title Case, Sentence case, lower, UPPER, all at once                                                                           | hand-written word splitter                                                                                                                                                                                 |
| 18  | `cron`        | Cron explainer        | convert  | Standard 5-field cron (`*`, lists, ranges, steps, month and weekday names, `@hourly`-style macros): an English description and the next 5 run times in local time; errors name the bad field | hand-written                                                                                                                                                                                               |
| 19  | `json`        | JSON format           | text     | Validate, pretty-print (2 or 4 spaces, tabs), minify, sort keys; error with line and column                                                                                                  | `JSON.parse` plus a position-to-line helper                                                                                                                                                                |
| 20  | `list`        | List to JSON or CSV   | text     | One item per line to a JSON array or one CSV row / column; trim and drop empty options                                                                                                       | hand-written                                                                                                                                                                                               |
| 21  | `diff`        | Text diff             | text     | Two inputs, unified or split view, ignore-whitespace option                                                                                                                                  | `@pierre/diffs/react` `MultiFileDiff` with `oldFile` / `newFile` (the component upstream renders diffs with; `apps/web/src/components/chat/MessagesTimeline.tsx` imports `FileDiff` from the same package) |
| 22  | `slug`        | Slugify               | text     | Lowercase ASCII slug; strips accents with `normalize("NFKD")`; separator option                                                                                                              | platform                                                                                                                                                                                                   |
| 23  | `count`       | Text stats            | text     | Characters, code points, words, lines, UTF-8 bytes                                                                                                                                           | `Intl.Segmenter` for words when present                                                                                                                                                                    |
| 24  | `url-parse`   | URL parser            | web      | Protocol, host, port, path, query parameters as a table, hash; builds the URL back from edited parameters                                                                                    | `URL`, `URLSearchParams`                                                                                                                                                                                   |
| 25  | `query`       | Query string and JSON | web      | `a=1&b=2&b=3` to JSON (repeated keys become arrays) and back                                                                                                                                 | `URLSearchParams`                                                                                                                                                                                          |
| 26  | `user-agent`  | User agent            | web      | Browser and version, engine, OS and version, device class (desktop, mobile, tablet, bot) for common agents; "Unknown" otherwise; defaults to the current `navigator.userAgent`               | hand-written ordered rule table                                                                                                                                                                            |

Limits common to all tools: input at most 1 MiB (UTF-8 bytes, checked before running);
output at most 2 MiB (truncated with a marker); generators cap counts.

## Tool definition

```ts
// apps/web/src/fork/utilities/types.ts
export type UtilityCategory = "encode" | "hash" | "generate" | "convert" | "text" | "web";

export type UtilityOption =
  | {
      readonly kind: "select";
      readonly id: string;
      readonly label: string;
      readonly choices: ReadonlyArray<{ readonly value: string; readonly label: string }>;
      readonly defaultValue: string;
    }
  | {
      readonly kind: "toggle";
      readonly id: string;
      readonly label: string;
      readonly defaultValue: boolean;
    }
  | {
      readonly kind: "number";
      readonly id: string;
      readonly label: string;
      readonly min: number;
      readonly max: number;
      readonly defaultValue: number;
    }
  | {
      readonly kind: "text";
      readonly id: string;
      readonly label: string;
      readonly defaultValue: string;
      readonly secret?: boolean;
    };

export type UtilityOptionValues = Readonly<Record<string, string | number | boolean>>;

export interface UtilityOutputField {
  readonly label: string;
  readonly value: string;
  readonly monospace?: boolean;
}

export type UtilityResult =
  | {
      readonly kind: "ok";
      readonly fields: ReadonlyArray<UtilityOutputField>;
      readonly warnings?: ReadonlyArray<string>;
    }
  | { readonly kind: "error"; readonly message: string };

export interface UtilityTool {
  readonly id: string;
  readonly label: string;
  readonly category: UtilityCategory;
  readonly description: string;
  readonly keywords: ReadonlyArray<string>;
  /** "none" for generators; "two" for diff and HMAC-style key + message tools. */
  readonly input: "text" | "none" | "two";
  readonly inputLabels?: readonly [string, string];
  readonly options: ReadonlyArray<UtilityOption>;
  readonly example?: {
    readonly input: string;
    readonly second?: string;
    readonly options?: UtilityOptionValues;
  };
  /** Pure and synchronous. Generators read randomness through the injected source. */
  readonly run: (input: UtilityRunInput) => UtilityResult;
  /** For two-way tools: the option change that reverses direction, used by Swap. */
  readonly swap?: (options: UtilityOptionValues) => UtilityOptionValues;
  /** Custom renderer instead of the field list (diff only). */
  readonly View?: ComponentType<{ readonly input: UtilityRunInput }>;
}

export interface UtilityRunInput {
  readonly text: string;
  readonly second: string;
  readonly options: UtilityOptionValues;
  readonly random: (bytes: number) => Uint8Array; // crypto.getRandomValues in the app, seeded in tests
  readonly now: () => number;
}
```

`run` is synchronous; every listed library call is synchronous. Output recomputes on input
change, debounced 120 ms for inputs over 64 KiB and immediate otherwise, inside
`useDeferredValue` so typing never blocks. Generators run on mount and on "Generate again",
not on every render.

Search (`registry.ts`): case-insensitive match over label, id and keywords, ranked by
prefix match, then substring, then recent use. No fuzzy library.

## State

`store.ts` (zustand, not persisted):

```ts
interface UtilitiesUiState {
  readonly selectedToolId: string | null;
  readonly dialogOpen: boolean;
  readonly drafts: Readonly<Record<string, { text: string; second: string; options: UtilityOptionValues }>>;
  select(toolId: string | null): void;
  setDraft(toolId: string, draft: Partial<...>): void;
  openDialog(toolId?: string): void;
  closeDialog(): void;
}
```

Drafts survive switching tools, closing and reopening the panel, and thread changes; they
vanish on reload. The only persisted value is recent tool ids,
`loom:utilities:recent:v1` (at most 8), through `resolveStorage`
(`apps/web/src/lib/storage.ts`) wrapped in try/catch.

## Web wiring

- **Panel.** `panel.tsx`:

  ```ts
  export const utilitiesPanel: ForkPanelDefinition = {
    id: "utilities",
    title: "Utilities",
    icon: WrenchIcon,
    shortcut: "U",
    unavailableHint: "Open a thread to use Utilities in the panel.",
    isAvailable: ({ threadRef }) => threadRef !== null, // client-only: no loomFeatures check
    Component: UtilitiesPanel,
  };
  ```

  The panel is mounted only while active (EXTENSION-POINTS.md, Right panels); its state is
  in the store, so remounting loses nothing.

- **Palette.** One submenu item, `value: "action:loom:utilities:open"`, title "Utilities...",
  `groups: [{ value: "loom-utilities", label: "Utilities", items }]` with one action per
  tool (`value: "action:loom:utilities:<id>"`, `searchTerms: [label, ...keywords]`,
  description = tool description). Each action calls `openUtilities(toolId, activeThreadRef)`.
  Item types: `CommandPaletteSubmenuItem` / `CommandPaletteActionItem`
  (`apps/web/src/components/CommandPalette.logic.ts:127-155`). Root search does not descend
  into submenu groups (`filterCommandPaletteGroups`, `CommandPalette.logic.ts:369-443`,
  matches only each group's own items), so the source also returns six root actions for the
  most used tools: "Decode JWT", "Base64", "Hash text", "Generate UUID", "Unix time", "Format
  JSON" (`value: "action:loom:utilities:<id>"`). The submenu's `searchTerms` include
  "utilities", "tools" and every category name, not every keyword, to keep root results
  short.

- **Open logic.** `openUtilities(toolId, threadRef)`: select the tool; if `threadRef` is set,
  `useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface("utilities"))`;
  otherwise `openDialog(toolId)`.

- **Dialog and command.** `UtilitiesDialogHost` (registered in `FORK_ROOT_COMPONENTS`) renders
  upstream's dialog primitive (`apps/web/src/components/ui/dialog.tsx`) with
  `UtilitiesView` when `dialogOpen`, and subscribes to `loom.utilities.open` with
  `onForkCommand`. The handler finds the active thread the way the palette registry does
  (`useHandleNewThread`, EXTENSION-POINTS.md section 8) and toggles: close the surface if
  Utilities is the active surface (`closeSurface`, `apps/web/src/rightPanelStore.ts:160`),
  close the dialog if open, otherwise `openUtilities(selectedToolId ?? "base64", threadRef)`.
  It renders `null` when the dialog is closed.

- **Copy.** Upstream's `useCopyToClipboard` (`apps/web/src/hooks/useCopyToClipboard.ts`)
  for the Copy buttons.

- **Layout.** At panel widths under 480 px the list and the tool view stack: the list shows
  until a tool is picked, and a back button returns to it. At 480 px and wider, list on the
  left (180 px), tool on the right. The dialog uses the wide layout at a fixed 760 px.

## Agent-facing tools

None.

## Performance

- Tool code is loaded only when the panel or dialog first opens:
  `const UtilitiesView = lazy(() => import("./UtilitiesView"))`. The palette source imports
  only `registry-meta.ts` (ids, labels, keywords, categories), not the implementations, so
  `@noble/hashes/legacy`, `jose` and `culori` stay out of the palette's chunk. (`culori` and
  `@noble/hashes/sha2` are already in the main bundle through upstream code.)
- The diff tool reuses upstream's diff worker pool when present
  (`apps/web/src/components/DiffWorkerPoolProvider.tsx`), otherwise passes
  `disableWorkerPool`.
- No timers, no animations beyond upstream's standard hover and the "Copied" label.
- Nothing touches the WebSocket.

## Alternatives considered

- **Old Loom's design** (`packages/utilities` plus server RPC, MCP toolkit and CLI, and a
  full-page area). Four surfaces for what is a local convenience; the server copy added
  wire traffic and an MCP tool listing that costs agent tokens every turn. Rejected.
- **A shared `packages/shared/src/fork/utilities`** so mobile could reuse the tools later.
  No consumer today (mobile is optional and has no panel); moving pure files later is cheap.
- **New libraries** (`cronstrue`, `ua-parser-js`, `diff`). Each needs Kyle's approval as a
  production dependency; the hand-written versions are small, tested and good enough, and
  diff rendering already exists.
- **`crypto.subtle` for hashes.** Unavailable on plain-`http` remote origins; see the
  secure-context section.
