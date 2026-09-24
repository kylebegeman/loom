# L27 technical design

All citations are to this fork at upstream v0.0.42 (commit `a931bd85f3`). Search for the
quoted code when line numbers drift.

## Overview

A client-only feature in `apps/web/src/fork/utilities/`:

```
tools/*.ts        pure functions, one file per category, no React
regexWorker.ts    Web Worker that runs the regex tester's matching (the only off-thread tool)
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

29 tools (Kyle added the regex tester, the CIDR calculator and the chmod calculator on
2026-09-24, and declined a BIP39 generator). "Lib" is what the implementation uses; every
one is already a dependency of `apps/web` (`apps/web/package.json` dependencies) or a
platform API. No new dependency.

| #   | Id            | Label                 | Category | Behavior                                                                                                                                                                                                                                                                                                                                                                                                      | Lib                                                                                                                                                                                                        |
| --- | ------------- | --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `base64`      | Base64                | encode   | Encode or decode UTF-8 text; URL-safe alphabet and padding options; decode accepts both alphabets and missing padding                                                                                                                                                                                                                                                                                         | `TextEncoder`, `TextDecoder` (`fatal: true` to report invalid UTF-8)                                                                                                                                       |
| 2   | `url`         | URL encode            | encode   | Encode or decode a component (`encodeURIComponent`) or a whole URL (`encodeURI`)                                                                                                                                                                                                                                                                                                                              | platform                                                                                                                                                                                                   |
| 3   | `html`        | HTML entities         | encode   | Escape `& < > " '`; decode named (a fixed table of the common 30) and numeric entities                                                                                                                                                                                                                                                                                                                        | hand-written                                                                                                                                                                                               |
| 4   | `json-string` | String escape         | encode   | Escape or unescape a JSON string literal                                                                                                                                                                                                                                                                                                                                                                      | `JSON.stringify` / `JSON.parse`                                                                                                                                                                            |
| 5   | `basic-auth`  | Basic auth header     | encode   | `user` + `password` to `Authorization: Basic ...` and back                                                                                                                                                                                                                                                                                                                                                    | base64 tool                                                                                                                                                                                                |
| 6   | `jwt`         | JWT decode            | encode   | Header and payload as formatted JSON; `exp`, `iat`, `nbf` as ISO and local time with "expired" flag; warning that the signature is not verified                                                                                                                                                                                                                                                               | `jose` `decodeJwt`, `decodeProtectedHeader`                                                                                                                                                                |
| 7   | `hash`        | Hash                  | hash     | MD5, SHA-1, SHA-256, SHA-384, SHA-512 of the UTF-8 input; hex or base64; all algorithms at once in a list                                                                                                                                                                                                                                                                                                     | `@noble/hashes`                                                                                                                                                                                            |
| 8   | `hmac`        | HMAC                  | hash     | Key and message; SHA-1, SHA-256, SHA-384, SHA-512; key as UTF-8, hex or base64                                                                                                                                                                                                                                                                                                                                | `@noble/hashes/hmac`                                                                                                                                                                                       |
| 9   | `uuid`        | UUID                  | generate | v4 and v7; count 1 to 100; uppercase option; also validates and reports the version of a pasted UUID                                                                                                                                                                                                                                                                                                          | `getRandomValues`, `Date.now`                                                                                                                                                                              |
| 10  | `ulid`        | ULID                  | generate | Crockford base32, 48-bit time plus 80 random bits; count; decode a ULID's timestamp                                                                                                                                                                                                                                                                                                                           | hand-written                                                                                                                                                                                               |
| 11  | `password`    | Password              | generate | Length 8 to 128; lowercase, uppercase, digits, symbols; exclude look-alikes; unbiased by rejection sampling; entropy estimate in bits                                                                                                                                                                                                                                                                         | `getRandomValues`                                                                                                                                                                                          |
| 12  | `token`       | Random token          | generate | N bytes (8 to 256) as hex, base64, or base64url                                                                                                                                                                                                                                                                                                                                                               | `getRandomValues`                                                                                                                                                                                          |
| 13  | `lorem`       | Lorem ipsum           | generate | Paragraphs, sentences or words from a fixed word list                                                                                                                                                                                                                                                                                                                                                         | hand-written                                                                                                                                                                                               |
| 14  | `number-base` | Number base           | convert  | Binary, octal, decimal, hex (and any base 2 to 36), with `0x` / `0b` / `0o` prefixes, big integers                                                                                                                                                                                                                                                                                                            | `BigInt`                                                                                                                                                                                                   |
| 15  | `timestamp`   | Unix time             | convert  | Seconds or milliseconds to ISO 8601 UTC, local time and relative time; ISO or `now` back to seconds and milliseconds                                                                                                                                                                                                                                                                                          | `Date`, `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`                                                                                                                                                   |
| 16  | `color`       | Color                 | convert  | Any CSS color to hex, RGB, HSL, OKLCH; alpha kept; a swatch                                                                                                                                                                                                                                                                                                                                                   | `culori/fn` (`parse`, `converter`, `formatHex8`, `formatRgb`, `formatHsl`), as `apps/web/src/themePalette.ts:4` imports it                                                                                 |
| 17  | `case`        | Case                  | convert  | camelCase, PascalCase, snake_case, CONSTANT_CASE, kebab-case, Title Case, Sentence case, lower, UPPER, all at once                                                                                                                                                                                                                                                                                            | hand-written word splitter                                                                                                                                                                                 |
| 18  | `cron`        | Cron explainer        | convert  | Standard 5-field cron (`*`, lists, ranges, steps, month and weekday names, `@hourly`-style macros): an English description and the next 5 run times in local time; errors name the bad field                                                                                                                                                                                                                  | hand-written                                                                                                                                                                                               |
| 19  | `json`        | JSON format           | text     | Validate, pretty-print (2 or 4 spaces, tabs), minify, sort keys; error with line and column                                                                                                                                                                                                                                                                                                                   | `JSON.parse` plus a position-to-line helper                                                                                                                                                                |
| 20  | `list`        | List to JSON or CSV   | text     | One item per line to a JSON array or one CSV row / column; trim and drop empty options                                                                                                                                                                                                                                                                                                                        | hand-written                                                                                                                                                                                               |
| 21  | `diff`        | Text diff             | text     | Two inputs, unified or split view, ignore-whitespace option                                                                                                                                                                                                                                                                                                                                                   | `@pierre/diffs/react` `MultiFileDiff` with `oldFile` / `newFile` (the component upstream renders diffs with; `apps/web/src/components/chat/MessagesTimeline.tsx` imports `FileDiff` from the same package) |
| 22  | `slug`        | Slugify               | text     | Lowercase ASCII slug; strips accents with `normalize("NFKD")`; separator option                                                                                                                                                                                                                                                                                                                               | platform                                                                                                                                                                                                   |
| 23  | `count`       | Text stats            | text     | Characters, code points, words, lines, UTF-8 bytes                                                                                                                                                                                                                                                                                                                                                            | `Intl.Segmenter` for words when present                                                                                                                                                                    |
| 24  | `url-parse`   | URL parser            | web      | Protocol, host, port, path, query parameters as a table, hash; builds the URL back from edited parameters                                                                                                                                                                                                                                                                                                     | `URL`, `URLSearchParams`                                                                                                                                                                                   |
| 25  | `query`       | Query string and JSON | web      | `a=1&b=2&b=3` to JSON (repeated keys become arrays) and back                                                                                                                                                                                                                                                                                                                                                  | `URLSearchParams`                                                                                                                                                                                          |
| 26  | `user-agent`  | User agent            | web      | Browser and version, engine, OS and version, device class (desktop, mobile, tablet, bot) for common agents; "Unknown" otherwise; defaults to the current `navigator.userAgent`                                                                                                                                                                                                                                | hand-written ordered rule table                                                                                                                                                                            |
| 27  | `regex`       | Regex tester          | text     | Pattern, flags (`d g i m s u v y`, default `g`) and test text; live matches with index, numbered and named groups, and the test text with matches highlighted; at most 1,000 matches; matching runs in a Web Worker with a 1 second limit (see "Regex tester")                                                                                                                                                | native `RegExp`, `String.prototype.matchAll`; a Vite `?worker` import                                                                                                                                      |
| 28  | `cidr`        | CIDR calculator       | web      | IPv4 or IPv6 block (`10.0.0.0/8`, `192.168.1.10/24`, `192.168.1.0 255.255.255.0`, `2001:db8::/32`): network, prefix, netmask and wildcard (IPv4), broadcast (IPv4), first and last usable, total and usable addresses (RFC 3021 rule for /31, single host for /32 and /128), range; host bits set are reported ("Network is 192.168.1.0/24"); "Address to check" option answers whether an IP is in the block | hand-written, `BigInt` for IPv6                                                                                                                                                                            |
| 29  | `chmod`       | chmod calculator      | convert  | Octal (`755`, `0644`, `4755`) or symbolic (`rwxr-xr-x`, or `ls -l` form `-rwsr-xr-x`) to octal, symbolic, `ls -l` form, a plain-English summary per class, special bits (setuid, setgid, sticky) and `chmod 755 <file>`; a 3 by 3 read, write, execute grid plus special-bit checkboxes edits the value both ways                                                                                             | hand-written                                                                                                                                                                                               |

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
  /** Custom renderer instead of the field list (diff, regex, chmod). */
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

`run` is synchronous; every listed library call is synchronous. The regex tester is the one
exception: its `run` only compiles the pattern (`new RegExp(pattern, flags)`, which cannot
hang) and reports a syntax error or an invalid flag; its `View` does the matching in the
worker. Output recomputes on input
change, debounced 120 ms for inputs over 64 KiB and immediate otherwise, inside
`useDeferredValue` so typing never blocks. Generators run on mount and on "Generate again",
not on every render.

Search (`registry.ts`): case-insensitive match over label, id and keywords, ranked by
prefix match, then substring, then recent use. No fuzzy library.

## Regex tester

A pattern with catastrophic backtracking (for example `(a+)+$` on a long run of `a`s) can
block the thread for minutes, and a synchronous `RegExp` cannot be interrupted. So matching
never runs on the main thread:

- `regexMatch.ts` (pure, tested directly): `matchAll(pattern, flags, text, { maxMatches:
1000 })` returns `{ matches: [{ index, end, value, groups: string[], named: Record<string,
string | undefined>, indices? }], truncated }`. Without the `g` flag it returns the first
  match only, as `exec` would (`matchAll` requires `g`); zero-length matches advance like `matchAll`.
- `regexWorker.ts` wraps it: `onmessage` receives `{ requestId, pattern, flags, text }`, posts
  back `{ requestId, result }` or `{ requestId, error }`. Loaded with a Vite `?worker` import,
  the same mechanism upstream uses for the diff worker
  (`apps/web/src/components/DiffWorkerPoolProvider.tsx:3`). Workers need no secure context,
  so this also works on plain-`http` remote origins.
- `RegexView.tsx`: debounces input by 150 ms, keeps one worker, and sends the latest request
  only. If no answer arrives within 1,000 ms it calls `worker.terminate()`, creates a fresh
  worker for the next run, and shows "Matching stopped after 1 second. The pattern may
  backtrack catastrophically on this text." Output: the match count, a table (index, match,
  groups by number and name) capped at 200 rows with "Show all" up to 1,000, and the test text
  with matches highlighted (plain spans, no HTML from the input). The worker is terminated on
  unmount.
- The worker creation goes through a small factory (`createRegexRunner(makeWorker, timeoutMs)`)
  so the timeout path is tested with a fake worker.

## CIDR and chmod

- `cidr.ts` parses IPv4 dotted quads (no leading-zero octals, each 0 to 255) and IPv6 (with
  `::` compression and an embedded IPv4 tail), a prefix (`/n`) or an IPv4 netmask that must be
  contiguous ("255.255.0.255 is not a valid netmask"). All arithmetic is on `bigint`, so IPv4
  and IPv6 share one code path. Output addresses are printed compressed for IPv6 (RFC 5952)
  with the expanded form as an extra field.
- `chmod.ts` converts between a 12-bit mode and its forms. It accepts 3 or 4 octal digits
  (optional leading `0` or `0o`), a 9-character symbolic string, or a 10-character `ls -l`
  string (first character a type such as `-` or `d`, which is ignored). Capital `S` and `T`
  mean the special bit without execute, as `ls` prints them. `ChmodView.tsx` renders the grid
  and writes the octal form back into the input on each click.

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
  JSON" (`value: "action:loom:utilities:quick:<id>"`, distinct from the submenu values). The
  submenu's `searchTerms` include "utilities", "tools" and every category name, not every
  keyword, to keep root results short.

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
- The regex tester matches in its own Web Worker with a 1 second limit, created on first use
  of that tool and terminated on unmount, so no regex can freeze the page.
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
- **Regex matching on the main thread with a step or length limit.** JavaScript cannot
  interrupt a running `RegExp`, so only a worker bounds the time. The earlier draft left
  regex out for this reason; the worker removes it.
- **A BIP39 mnemonic generator.** Declined by Kyle. Old Loom faked it with a small word list;
  a real one needs the 2,048-word list and a checksum, for little use in this app.
