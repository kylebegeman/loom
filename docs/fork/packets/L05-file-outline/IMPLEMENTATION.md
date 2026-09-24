# L05 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. No test data is needed beyond a few source files; the fixtures live in the tests.

## File layout

```
apps/web/src/fork/file-outline/
  outline.ts                 types, extension map, extractOutline(), MAX_OUTLINE_SYMBOLS
  scanner.ts                 comment/string masking, brace and indent walkers
  languages/typescript.ts    TS, TSX, JS (shared rules)
  languages/swift.ts
  languages/python.ts
  languages/go.ts
  languages/rust.ts
  languages/kotlin.ts
  languages/markdown.ts
  outlineCache.ts            single-entry memo keyed by (path, contents)
  filter.ts                  subsequence filter that keeps ancestors
  store.ts                   zustand store, persisted "open"
  FileOutlineSlots.tsx       LoomFileOutlineToggle, LoomFileOutlineColumn
  FileOutlineList.tsx        list rendering, keyboard handling
  palette.tsx                fileOutlinePaletteSource
  FileOutlineShortcuts.tsx   onForkCommand listener, mounted in ForkRoot
  __fixtures__/              small source files per language
  *.test.ts                  next to each tested file
```

## Steps

1. **Extension points.** Run the existence checks for `ext-web-root`, `ext-palette` and
   `ext-keybindings` in EXTENSION-POINTS.md. Create any missing one exactly as specified, one
   commit each (`feat(fork): add the <name> extension point`), with its FORK.md rows.
2. **Scanner.** `scanner.ts` with `maskSource(source, config): string` (same length, newlines
   kept) and `walkBraces(masked, onOpen, onClose)`. Test masking on each language's tricky
   literals first (template literals with `${}`, Python triple quotes, Rust raw strings and
   lifetimes, Swift `#"..."#`, Kotlin raw strings with templates, nested block comments).
3. **Extractors.** One file per language, each exporting an `OutlineExtractor`. Write the
   fixture and the expected symbol list first, then the rules. Keep each rule table
   declarative:

   ```ts
   interface DeclarationRule {
     readonly kind: OutlineSymbolKind;
     /** Tested against the masked line from its first non-space character. */
     readonly pattern: RegExp; // named group `name`, optional `detail`
     readonly opensScope: boolean;
     /** Where the rule applies; locals inside function bodies are never emitted. */
     readonly allowedIn: ReadonlyArray<"file" | "type" | "namespace" | "impl">;
   }
   ```

   Swift `// MARK:` headings read the raw line (comments are masked in the scanned copy).

4. **`outline.ts`.** Extension map, `extractOutline` with try/catch and the symbol cap,
   `outlineLanguageForPath`. `outlineCache.ts` memo. `filter.ts`.
5. **Store.** `store.ts` as in TECHNICAL (persist only `open`, key
   `loom:file-outline:open:v1`, storage from `resolveStorage`). Wrap direct storage access in
   try/catch.
6. **Components.** `FileOutlineSlots.tsx` and `FileOutlineList.tsx`. Use upstream primitives:
   `FileSurfaceAction` from `~/components/files/fileSurfaceChrome`, `Input` from
   `~/components/ui/input`, `ScrollArea`, lucide icons, `cn`. Match the explorer aside's
   border and background classes (`FilePreviewPanel.tsx:1279-1286`).
7. **Seams.** Apply the three seams in [SEAMS.md](./SEAMS.md) to `FilePreviewPanel.tsx`, run
   `vp fmt` on the file, and check the marker count is 3.
8. **Palette and keybinding.** Append `fileOutlinePaletteSource` to
   `FORK_COMMAND_PALETTE_SOURCES`, `"loom.file-outline.toggle"` to
   `FORK_KEYBINDING_COMMANDS`, and `{ id: "file-outline-shortcuts", Component:
FileOutlineShortcuts }` to `FORK_ROOT_COMPONENTS`.
9. **Docs.** `docs/fork/user/file-outline.md`: what it does, the header button, the palette
   entries, that the keybinding is unbound until assigned, and that Markdown headings jump in
   source view. FORK.md "Packet seams" row. Set Status in the packets index.

Commit the extension points separately, then the packet as
`feat(fork-file-outline): show an outline of the open file and jump to symbols`. Revert
`pnpm-lock.yaml` noise before every commit.

## Pitfalls

- **Line numbers.** The masked copy must keep every newline in place, including inside block
  comments and multi-line strings, or every later symbol points at the wrong line.
- **CRLF files.** Split on `\n` and strip a trailing `\r`; do not count `\r` as a newline.
- **Arrow functions spread over lines.** `export const handler = async (\n  a,\n) => {`
  must match; test with the rule applied to the joined logical statement (up to 5 lines,
  stopping at `;` or `{`).
- **Object literal methods and JSX.** Do not emit JSX attribute arrows or callbacks passed as
  arguments; the "allowed scope" rule handles this, keep a fixture for it.
- **Go receivers** on types declared in another file: emit flat methods named `(T).Name`.
- **Rendered Markdown.** A click switches to source view at the line; this is upstream's
  reveal behavior and expected.
- **Do not copy the file text** into the store; keep the reference the query holds, so memory
  stays flat across files.
- **Hooks in the palette.** `items()` must not call hooks; read the store with `getState()`.
- **Existing tests.** `FilePreviewPanel.test.ts` covers logic helpers only; the seams must not
  change its imports or exported helpers.

## Phase 2 (conditional): tree-sitter

Not part of the v1 build. Start it only when the trigger is met.

Trigger: Kyle reports (or a tracking issue records) real files where the v1 outline misses
or misplaces symbols, and the fix is not a reasonable scanner rule (for example it needs
real parsing of a construct rather than one more pattern). Record the failing files as
fixtures first; they become the phase 2 acceptance tests.

Steps, only for the languages that failed:

1. Measure: WASM size and load time for each needed grammar from `@vscode/tree-sitter-wasm`
   or `tree-sitter-wasms` (check the license and that the grammar exists; Swift and Kotlin
   availability is unverified). Pick the smaller maintained source.
2. Add `web-tree-sitter` to `apps/web` (dependency approved by Kyle) and the grammar files;
   commit only the intended lockfile change.
3. `treeSitter/` provider per TECHNICAL.md, "Phase 2 (conditional)"; switch those languages
   in the extractor map with the scanner as fallback.
4. Run the language fixture tests against the new provider (the expected symbol lists stay
   the same) plus the recorded failing files; add a test that a grammar load failure falls
   back to the scanner.
5. Check the web build and the desktop build both serve the WASM (manual pass with Kyle's
   permission).

Commit as `feat(fork-file-outline): parse <languages> outlines with tree-sitter`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Every language in scope has a fixture test with the full expected symbol list.
- Clicking any symbol in a 5,000-line TS file lands on the right line.
- The outline follows an edit in the editable surface within about 200 ms.
- The feature works unchanged against an upstream T3 server.
