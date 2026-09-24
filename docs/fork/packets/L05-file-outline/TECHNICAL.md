# L05 technical design

Citations are to this fork at upstream v0.0.42 (`a931bd85f3`). Search for the quoted code if
lines have drifted.

## Overview

```
FilePreviewPanel (upstream, 3 seams)
 ├─ header: <LoomFileOutlineToggle>      publishes {threadKey, path, contents} to the store,
 │                                        renders the toggle button
 └─ body:   <LoomFileOutlineColumn>      when open: extractOutline(path, contents) (memoized,
                                          debounced on edits) -> filterable list
                                          click -> useRightPanelStore.openFile(ref, path, line)
fork store (zustand, persisted "open" flag) <- palette items, keybinding listener
```

Everything is in `apps/web/src/fork/file-outline/`. No contracts, no server, no client-runtime
code.

## How the outline finds the file text

`FilePreviewPanel` already loads the file with `useProjectFileQuery(environmentId, cwd,
relativePath, enabled)` (`apps/web/src/components/files/FilePreviewPanel.tsx:944-949`) and
holds `file.data.contents` and `file.data.truncated`. Edits in the editable surface write the
new text back into the same query cache through `setProjectFileQueryData`
(`FilePreviewPanel.tsx:602`), so the parent re-renders with fresh `file.data.contents`. The
seams pass those values as props; the outline issues no RPC of its own.

The props are only passed for a workspace or host text file:
`attachment === undefined && !isMedia && !isPdf`. The fork component also hides itself for
table files (CSV/TSV) and unsupported extensions.

## How click-to-jump works

Upstream already has a line reveal:

- `useRightPanelStore.getState().openFile(ref, relativePath, line)`
  (`apps/web/src/rightPanelStore.ts:137`, implemented at `577-600`) re-targets the existing
  `file:<path>` surface with `revealLine` and an incremented `revealRequestId`.
- `ChatView` passes both to `FilePreviewPanel` (`ChatView.tsx:9294-9303`), whose
  `useFileLineReveal` (`FilePreviewPanel.tsx:379-542`) scrolls the virtualized file, centers
  the line with `resolveCenteredFileLineScrollTop`
  (`apps/web/src/components/files/fileLineReveal.ts`) and marks it with
  `FILE_LINK_REVEAL_ATTRIBUTE` (`fileSurfaceChrome.tsx:19`).
- A pending reveal forces source view over rendered Markdown, HTML or tables
  (`revealHandled`, `FilePreviewPanel.tsx:984-989`). Clicking a Markdown heading therefore
  switches to source at that heading. Acceptable for v1; a rendered-Markdown anchor scroll is
  out of scope.

The outline calls exactly that action. It works for workspace files and for host files
(absolute paths), which use the same surface id scheme.

## Parser choice

| Option                                                                       | Accuracy                                                                                                                                 | Cost                                                                                                                                                                                               | Verdict                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Line regex only (old Loom `fileOutline.logic.ts`)                            | Poor: matches inside comments and strings, depth from indentation only                                                                   | none                                                                                                                                                                                               | Starting point, not enough                |
| **Scanner plus per-language declaration rules (fork code)**                  | Good for outlines: comments and strings masked, nesting from braces (C-family) or indentation (Python), Markdown headings outside fences | ~600 lines, no dependency, synchronous, a few ms per 100 KB                                                                                                                                        | **v1**                                    |
| `web-tree-sitter` + grammar WASM + `tags.scm` queries                        | Best: real parse trees, the same `@definition.*` captures GitHub code navigation uses                                                    | New production dependency (MIT), WASM assets per language (roughly 0.3 to 3 MB each, Swift among the largest; unverified, measure before deciding), async init, asset serving in Vite and Electron | Conditional phase 2 (approved by Kyle)    |
| Shiki TextMate scopes (Shiki 4.2 is already bundled through `@pierre/diffs`) | Medium: `entity.name.function` also marks call sites in some grammars; tokenizing a large file on the main thread is slow                | No new dependency, but couples to `@pierre/diffs` internals and its worker pool                                                                                                                    | Rejected                                  |
| Server-side parse RPC                                                        | Could use native tree-sitter                                                                                                             | Needs `ext-core`, breaks "works on upstream servers", adds a round trip                                                                                                                            | Rejected (old Loom D7 made the same call) |

Prebuilt grammar packages exist (`@vscode/tree-sitter-wasm`, MIT, about 16 languages;
`tree-sitter-wasms`); whether maintained Swift and Kotlin WASM grammars ship in them is
unverified.

### Phase 2 (conditional): tree-sitter

Approved by Kyle as a dependency, but built only when the trigger in
[IMPLEMENTATION.md](./IMPLEMENTATION.md#phase-2-conditional-tree-sitter) is met. Design:

- `apps/web/src/fork/file-outline/treeSitter/` adds a `TreeSitterOutlineProvider` per
  language that implements the same `OutlineExtractor` interface, so the column, palette,
  cache and tests do not change.
- `web-tree-sitter` and a grammar's WASM load lazily on the first outline of that language
  (dynamic `import()`, WASM referenced as a Vite asset URL so web and the desktop bundle
  serve it the same way; verify the asset handling in both builds). Nothing loads while the
  column is closed.
- Symbols come from each grammar's `tags.scm` `@definition.*` captures (a fork-owned query
  where a grammar ships none), mapped to `OutlineSymbolKind`; depth from ancestor
  definitions.
- The scanner extractor stays registered as the fallback: it is used while the grammar
  loads, when loading fails, and for languages without a working grammar. The first
  outline of a file therefore never waits on a WASM download.
- Only languages that met the trigger switch; each switch is a one-line change in the
  extractor map.

## Extractor design

`apps/web/src/fork/file-outline/outline.ts`:

```ts
export type OutlineSymbolKind =
  | "class"
  | "struct"
  | "enum"
  | "interface"
  | "protocol"
  | "trait"
  | "extension"
  | "impl"
  | "type"
  | "function"
  | "method"
  | "constant"
  | "variable"
  | "module"
  | "heading";

export interface OutlineSymbol {
  /** Stable within one extraction: `${line}:${name}`. */
  readonly id: string;
  readonly name: string;
  readonly kind: OutlineSymbolKind;
  /** 1-based line of the declaration's name. */
  readonly line: number;
  /** 0-based nesting depth, capped at 8. */
  readonly depth: number;
  /** Short suffix shown dimmed: `(a, b)`, `: string`, `extends Base`. Max 60 chars. */
  readonly detail?: string;
}

export interface OutlineResult {
  readonly languageId: OutlineLanguageId;
  readonly symbols: ReadonlyArray<OutlineSymbol>;
  /** True when MAX_OUTLINE_SYMBOLS cut the list. */
  readonly capped: boolean;
}

export type OutlineLanguageId =
  "typescript" | "javascript" | "swift" | "python" | "go" | "rust" | "kotlin" | "markdown";

export interface OutlineExtractor {
  readonly languageId: OutlineLanguageId;
  readonly extract: (source: string) => ReadonlyArray<OutlineSymbol>;
}

export const MAX_OUTLINE_SYMBOLS = 2_000;

/** null when the path has no extractor; never throws. */
export function extractOutline(path: string, source: string): OutlineResult | null;
export function outlineLanguageForPath(path: string): OutlineLanguageId | null;
```

Extension map: `ts mts cts tsx` to typescript; `js mjs cjs jsx` to javascript (same rules,
shared implementation); `swift`; `py pyi`; `go`; `rs`; `kt kts` to kotlin; `md mdx markdown`.

### Shared scanner (`scanner.ts`)

One pass over the source producing a **masked copy** of the same length in which comment and
string contents are replaced by spaces (newlines kept), so line numbers and column offsets
stay valid and declaration regexes never match inside them. Per-language config:

```ts
interface ScanConfig {
  readonly lineComment: ReadonlyArray<string>; // ["//"] or ["#"]
  readonly blockComment: readonly [string, string] | null; // ["/*", "*/"]
  readonly nestedBlockComments: boolean; // Swift, Rust, Kotlin: true
  readonly strings: ReadonlyArray<StringRule>; // quotes, raw strings, templates
}
```

String rules cover: `'` `"` with escapes; TS/JS template literals (masking `${...}` content
is acceptable for an outline); Python triple quotes and prefixes (`r`, `f`, `b`); Go raw
backtick strings; Rust raw strings `r#"..."#` and char literals vs lifetimes (`'a` is a
lifetime when not closed within 3 chars); Swift multi-line `"""` and `#"..."#`; Kotlin
`"..."` and raw `"""..."""` strings (both with `$name` and `${...}` templates) and char
literals.

### Nesting

- Brace languages (TS/JS, Swift, Go, Rust, Kotlin): walk the masked text tracking `{`/`}` depth. A
  declaration opens a scope if its `{` is found before the next `;` or declaration on the
  same logical statement; its children are declarations inside that brace range. A stack of
  `(symbolDepth, braceDepth)` pairs yields each symbol's `depth`. Function bodies are
  scopes too, so locals inside functions are skipped: only declarations whose enclosing scope
  is the file, a type, an impl/extension, a namespace/module, or an object literal assigned to
  a top-level `const` are emitted.
- Python: indentation-based, using the masked text so docstrings and brackets do not count.
  Continuation lines inside open brackets are skipped.
- Markdown: ATX headings (`#` to `######`) and setext headings (`===`, `---` under a text
  line), ignoring fenced code blocks (``` and ~~~) and front matter. Depth is level minus the
  smallest level present.

### Declaration rules (applied to masked lines at statement start)

- TS/JS: `class`, `abstract class`, `interface`, `type X =`, `enum`, `const enum`,
  `namespace`/`module`, `function`/`function*`/`async function`, `export default function`,
  `const|let|var X = (async)? (...) =>` or `= function`, class members (`name(`, `get name(`,
  `set name(`, `static`, `#private(`, arrow-valued properties), all with optional `export`,
  `declare`, `default`, modifiers and decorators on previous lines. Top-level `const X =` of a
  non-function value is emitted as `constant` only when exported (keeps noise down).
- Swift: `class`, `struct`, `enum`, `protocol`, `extension X`, `actor`, `func`, `init`,
  `deinit`, `subscript`, `var`/`let` members of types (not locals), `case` inside enums,
  `typealias`, with attributes (`@MainActor`) and modifiers (`public`, `private`,
  `fileprivate`, `internal`, `open`, `static`, `final`, `override`, `mutating`, `nonisolated`,
  `convenience`, `required`). `// MARK: - Title` comments are emitted as `heading` (read from
  the raw text, since comments are masked).
- Python: `class`, `def`, `async def`, decorated definitions (line of `def`/`class`),
  module-level `UPPER_CASE =` as `constant`.
- Go: `func Name(`, `func (r *T) Name(` (method, grouped under `T` when `T` is declared in
  the file, otherwise flat), `type T struct|interface|...`, grouped `type (...)`, `const`/
  `var` blocks at top level as `constant`/`variable`.
- Rust: `fn`, `struct`, `enum`, `trait`, `impl X`, `impl Trait for X`, `mod`, `type`,
  `const`, `static`, `macro_rules! name`, with `pub(...)`, `async`, `unsafe`, `extern "C"`,
  attributes on previous lines.
- Kotlin: `class`, `data class`, `sealed class`/`sealed interface`, `enum class`,
  `annotation class`, `value class`, `interface`, `fun interface`, `object` and
  `companion object` (kind `class`, detail `object`), `fun` including extension functions
  (`fun Type.name(`, shown as `Type.name`) and generic ones (`fun <T> name(`), `val`/`var`
  properties of types and at top level (`const val` as `constant`; other top-level
  properties only when not `private`), `typealias`, entries of an `enum class` as
  `constant`, with annotations (`@Composable`, possibly on previous lines) and modifiers
  (`public`, `private`, `protected`, `internal`, `open`, `abstract`, `override`, `final`,
  `suspend`, `inline`, `tailrec`, `operator`, `infix`, `external`, `lateinit`, `inner`,
  `expect`, `actual`). Backticked names keep their text without backticks.

Rules are a table per language (`languages/typescript.ts`, `swift.ts`, ...), each exporting
an `OutlineExtractor`. `extractOutline` wraps the call in try/catch and returns an empty
result on error, logging once per path.

## Store

`apps/web/src/fork/file-outline/store.ts`, zustand:

```ts
interface FileOutlineState {
  /** Persisted: the column is open. */
  readonly open: boolean;
  /** Session only: the file the Files panel currently shows, per thread. */
  readonly sources: Readonly<Record<string, OutlineSource>>; // key: scopedThreadKey
  readonly focusRequestId: number;
  setOpen(open: boolean): void;
  toggle(): void; // opening also bumps focusRequestId
  publish(threadKey: string, source: OutlineSource): void;
  unpublish(threadKey: string, path: string): void;
}

interface OutlineSource {
  readonly threadRef: ScopedThreadRef;
  readonly path: string;
  readonly contents: string; // the query's own string, not a copy
  readonly truncated: boolean;
}
```

Only `open` is persisted, under `loom:file-outline:open:v1`, with
`persist(..., { storage: createJSONStorage(() => resolveStorage(window.localStorage)),
partialize })` like `rightPanelStore.ts:860-874`. Reads and writes go through
`resolveStorage` (`apps/web/src/lib/storage.ts`), which already falls back to memory storage.

`scopedThreadKey` is upstream's helper from `@t3tools/client-runtime/environment`, the same
import `rightPanelStore.ts:10` uses.

A memoized `outlineFor(source)` keeps a single-entry cache keyed by `(path, contents)`
reference equality, shared by the column and the palette, so the palette never re-parses
what the column already parsed.

## Components

`apps/web/src/fork/file-outline/FileOutlineSlots.tsx` exports the two seam components.

```tsx
export function LoomFileOutlineToggle(props: {
  readonly threadRef: ScopedThreadRef;
  readonly relativePath: string;
  readonly contents: string | null; // null while loading or for non-text files
  readonly truncated: boolean;
}): ReactElement | null;
```

- Returns null unless `outlineLanguageForPath(relativePath) !== null`.
- `useEffect` publishes `{threadRef, path, contents, truncated}` while mounted with non-null
  contents; unpublishes on unmount or path change.
- Renders upstream's `FileSurfaceAction` (`fileSurfaceChrome.tsx:67`) with `ListTreeIcon`
  from `lucide-react`, `pressed={open}`, label "Show outline" / "Hide outline".

```tsx
export function LoomFileOutlineColumn(props: {
  readonly threadRef: ScopedThreadRef;
  readonly relativePath: string | null;
  readonly contents: string | null;
  readonly truncated: boolean;
  readonly revealLine: number | null;
}): ReactElement | null;
```

- Null when closed, no path, or unsupported language.
- `useDeferredValue(contents)` plus a 150 ms trailing debounce before re-extracting while the
  user types, so keystrokes never wait on a parse.
- Layout: an `<aside>` placed before upstream's explorer aside, `w-[min(16rem,40%)] min-w-48
border-l border-border/60`, header row ("Outline", count), filter `Input`, then the list.
  With the explorer also open both columns show; the file keeps at least half the width
  because both use percentage caps.
- The list is plain DOM for up to 300 visible rows and upstream's `@legendapp/list` (already
  a web dependency) beyond that. Each row: kind icon (lucide, 12 px), name, dimmed detail,
  indentation `depth * 12px`.
- The row matching the latest `revealLine` (the nearest symbol at or above it) is marked
  `aria-current` and scrolled into view once per reveal.
- Keyboard: the filter handles Up/Down/Enter/Escape (Escape clears the filter, then returns
  focus to the file). Rows are buttons with `role="option"` inside `role="listbox"`.
- Filter: case-insensitive subsequence match on the name; matches keep their ancestors
  visible (dimmed) so nesting still reads.
- `focusRequestId` changes focus the filter.

Jump:

```ts
const jump = (symbol: OutlineSymbol) =>
  useRightPanelStore.getState().openFile(props.threadRef, props.relativePath!, symbol.line);
```

## Command palette (`ext-palette`)

`apps/web/src/fork/file-outline/palette.tsx` exports `fileOutlinePaletteSource`:

- `action:loom:file-outline:toggle`: "Toggle file outline", present only when
  `sources[threadKey]` exists for `context.activeThreadRef`. `run` calls `toggle()`;
  `shortcutCommand: "loom.file-outline.toggle"`.
- `action:loom:file-outline:go-to-symbol`: a `CommandPaletteSubmenuItem`
  (`CommandPalette.logic.ts:150-155`) whose single group lists up to 500 symbols of the
  published source as action items (`searchTerms: [name, kind]`, `title: name`,
  `description: kind and line`), each running `openFile(ref, path, line)`.

Items are built from the store with `useFileOutlineStore.getState()` inside `items()`
(no hooks, as the extension point requires). Palette search runs over the items the palette
already holds; no extra filtering code.

## Keybinding (`ext-keybindings`)

Add `"loom.file-outline.toggle"` to `FORK_KEYBINDING_COMMANDS`. A small listener component
registered in `ForkRoot` (`{ id: "file-outline-shortcuts", Component:
FileOutlineShortcuts }`) subscribes with `onForkCommand("loom.file-outline.toggle", ...)`
and calls `toggle()` only when a source is published for some thread (otherwise returns
without consuming, so the key falls through). No default binding.

## Agent-facing tools

None. Agents read files directly.

## Performance

- No network traffic; no subscription.
- Extraction is O(n) in file size. Budget: under 10 ms for 100 KB and under 60 ms for the 1 MB
  preview cap on a recent Mac; the test suite includes a 1 MB synthetic file with a generous
  time guard to catch accidental quadratic behavior.
- Extraction runs only while the column is open or the palette asks; the toggle only
  publishes a string reference.
- Re-extraction on edit is debounced and deferred. No animation; the list does not repaint
  while idle.
- `MAX_OUTLINE_SYMBOLS` bounds render cost; large lists virtualize.

## Why not a separate panel

The right panel extension point (`ext-panels`) gives a fork a tab. The right panel shows one
active surface at a time (`ThreadRightPanelState.activeSurfaceId`,
`rightPanelStore.ts:109-113`), so an "Outline" tab would hide the file it outlines, and
old Loom's solution (a Files-panel sub-tab) was itself a view switch. The outline has to sit
beside the source, which only `FilePreviewPanel` can render. Hence the packet seams.

## Alternatives considered

- Popover instead of a column (one seam fewer): hides the source while navigating and cannot
  stay open across files. Rejected; the palette submenu already covers the quick-jump case.
- Reading the file again through a fork query: duplicate RPC and a stale-copy risk while
  editing. Rejected.
- Scroll-sync via DOM observation of `[data-line]` rows in the virtualizer: feasible but
  fragile against `@pierre/diffs` markup changes. Deferred.
