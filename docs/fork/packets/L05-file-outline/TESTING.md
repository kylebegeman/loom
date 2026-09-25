# L05 testing

Focused tests, no repo-wide checks, no sleeps. All tests are pure logic except one store test;
no component is rendered to static markup.

## Automated tests

| File                                                                                 | Covers                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/file-outline/scanner.test.ts`                                     | Masking keeps length and newlines; comments and strings are blanked for every language config, including template literals with `${}`, Python triple-quoted strings and prefixes, Rust raw strings and lifetimes, Swift raw and multi-line strings, Kotlin raw strings with `${}` templates, nested block comments (Swift, Rust, Kotlin).                                                                      |
| `apps/web/src/fork/file-outline/languages/typescript.test.ts`                        | Fixture with classes, abstract classes, interfaces, type aliases, enums, namespaces, overloads, decorators, generics, exported arrow functions split over lines, class members (getters, setters, static, `#private`), object-literal exports, and negative cases: callbacks passed as arguments, JSX attribute arrows, locals inside functions, declarations inside comments and strings. Also a TSX fixture. |
| `apps/web/src/fork/file-outline/languages/swift.test.ts`                             | Types, extensions, protocols, actors, `init`/`deinit`/`subscript`, enum cases, attributes and modifiers, `// MARK:` headings, locals inside functions skipped.                                                                                                                                                                                                                                                 |
| `apps/web/src/fork/file-outline/languages/python.test.ts`                            | Classes, methods, nested functions skipped, decorators, async defs, module constants, docstrings containing `def`.                                                                                                                                                                                                                                                                                             |
| `apps/web/src/fork/file-outline/languages/go.test.ts`                                | Funcs, methods with pointer and value receivers grouped under their type, grouped `type (...)` blocks, receivers on types from another file.                                                                                                                                                                                                                                                                   |
| `apps/web/src/fork/file-outline/languages/rust.test.ts`                              | Structs, enums, traits, `impl` and `impl Trait for`, nested `mod`, `pub(crate)`, attributes, `macro_rules!`, lifetimes not treated as chars.                                                                                                                                                                                                                                                                   |
| `apps/web/src/fork/file-outline/languages/kotlin.test.ts`                            | Classes (data, sealed, enum with entries, value, annotation), interfaces and `fun interface`, `object` and `companion object`, extension and generic functions, `suspend` and other modifiers, annotations on previous lines, `const val` and top-level properties, `typealias`, backticked names, locals inside functions skipped, declarations inside raw strings skipped.                                   |
| `apps/web/src/fork/file-outline/languages/markdown.test.ts`                          | ATX and setext headings, fenced code blocks ignored (both fence styles), front matter ignored, depth normalized to the smallest level.                                                                                                                                                                                                                                                                         |
| `apps/web/src/fork/file-outline/outline.test.ts`                                     | Extension map (every listed extension resolves, unknown ones return null), symbol cap sets `capped`, an extractor that throws yields an empty result, CRLF line numbers, and a 1 MB synthetic TS file extracts under a generous time guard (for example 1,000 ms) to catch quadratic behavior.                                                                                                                 |
| `apps/web/src/fork/file-outline/filter.test.ts`                                      | Subsequence matching, case folding, ancestors kept for matching children.                                                                                                                                                                                                                                                                                                                                      |
| `apps/web/src/fork/file-outline/store.test.ts`                                       | `toggle` flips `open` and bumps `focusRequestId` only when opening; `publish`/`unpublish` by thread key and path; only `open` is persisted (partialize).                                                                                                                                                                                                                                                       |
| `apps/web/src/fork/commandPalette/registry.test.ts` (extension point test, extended) | Item values stay unique and start with `action:loom:`.                                                                                                                                                                                                                                                                                                                                                         |
| `packages/contracts/src/fork/keybindings.test.ts` (extension point test)             | `loom.file-outline.toggle` decodes as a `KeybindingCommand` and is not an upstream command.                                                                                                                                                                                                                                                                                                                    |

## Commands

```sh
vp test run \
  apps/web/src/fork/file-outline/scanner.test.ts \
  apps/web/src/fork/file-outline/languages/*.test.ts \
  apps/web/src/fork/file-outline/outline.test.ts \
  apps/web/src/fork/file-outline/filter.test.ts \
  apps/web/src/fork/file-outline/store.test.ts \
  apps/web/src/fork/commandPalette/registry.test.ts \
  packages/contracts/src/fork/keybindings.test.ts
vp lint apps/web/src/fork/file-outline apps/web/src/components/files/FilePreviewPanel.tsx
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/contracts typecheck   # only if this packet created ext-keybindings
```

If this packet created `ext-keybindings`, also typecheck `t3`, `@t3tools/client-runtime` and
`@t3tools/mobile` (the contracts change reaches them).

## Manual check

With Kyle's permission (AGENTS.md: ask before browsers or dev servers), in one integrated pass
with `test-t3-app` on web, then the desktop dev build:

1. Open a thread in a project, open the Files panel, open a large TS file. The outline button
   appears in the header; toggle it on. Symbols appear, nested.
2. Click a method near the bottom: the file scrolls and highlights that line. Repeat with the
   same symbol (a second reveal must still scroll).
3. Type in the filter; use Up, Down, Enter; Escape clears then returns focus.
4. Edit the file in the editable surface: add a function; the outline updates without lag in
   typing.
5. Open a Swift, Python, Go, Rust, Kotlin and Markdown file in turn; the column stays open and follows.
   In rendered Markdown, click a heading: the view switches to source at the heading.
6. Open an image, a PDF and a CSV: no button, no column.
7. Open a host file outside the workspace (absolute path from a chat link): outline works and
   jumps.
8. Command palette: "Toggle file outline" and "Go to symbol in file" appear only while a file
   is active; choosing a symbol jumps.
9. Assign a key to "Loom: File Outline: Toggle" in Settings, Keybindings; it toggles and
   focuses the filter.
10. Reload the app: the open state is remembered.
11. Connect the Loom client to an upstream T3 server (or a remote environment): the outline
    still works, since it is client-only.

## Merge safety

Record the result of the merge preview (SEAMS.md, "Merge check") against the newest nightly
tag. After Kyle merges to `main`, `scripts/fork/loom.sh integrate nightly --dry-run` from a
clean, synced `main` must pass. The packet's `docs/fork/seams.tsv` row for
`FilePreviewPanel.tsx` (marker `file-outline`, 3 lines) makes it fail if a merge drops a seam.

## Acceptance criteria

- All tests above pass; web typecheck and lint on changed files are clean;
  `pnpm-lock.yaml` untouched.
- Outline accurate on the fixtures for all eight language ids.
- No new dependency in v1 (`web-tree-sitter` only arrives with the conditional phase 2).
- Jump lands on the declaration line for every symbol kind.
- No network requests added (check the devtools network panel during the manual pass).
- No continuous repaint while the outline is open and idle.

Phase 2, if triggered: the same fixture tests pass against the tree-sitter provider, the
recorded failing files produce correct outlines, a grammar load failure falls back to the
scanner, and the web and desktop builds both load the WASM.
