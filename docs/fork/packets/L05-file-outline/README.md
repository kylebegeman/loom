# L05: File outline

Status: Not started.

A symbol list for the file open in the Files panel. A toggle in the file header opens an
outline column beside the source (functions, classes, types, methods, Markdown headings);
clicking a symbol scrolls the file to its line. The same symbols are searchable from the
command palette ("Go to symbol in file"). It runs entirely in the client on the file text
the panel already loaded, so it needs no server support and works against any T3 server.

## Scope

- In:
  - An outline column inside the Files panel (`FilePreviewPanel`), toggled from the file
    header, remembered across files and restarts.
  - Symbol extraction for TypeScript, TSX, JavaScript (all module flavors), Swift, Python, Go,
    Rust and Markdown (headings), with nesting, a filter box and keyboard navigation.
  - Click (or Enter) jumps to the symbol's line using upstream's existing reveal mechanism.
  - The outline follows edits in the editable file surface (debounced re-parse).
  - Command palette: "Toggle file outline" and a "Go to symbol in file" submenu.
  - An unbound keybinding command, `loom.file-outline.toggle`.
- Out:
  - Scroll-sync (highlighting the symbol under the viewport while scrolling). The virtualized
    `@pierre/diffs` surface gives no cheap scroll-to-line mapping; revisit later.
  - Tree-sitter parsing. Evaluated in [TECHNICAL.md](./TECHNICAL.md#parser-choice); a
    possible phase 2 behind the same interface, which needs a new dependency and Kyle's
    approval.
  - Project-wide symbol search and cross-file references. That is the code graph (L26).
  - Outlines inside the diff panel, pull request panel or chat code blocks.
  - Mobile UI.

## Surfaces

Web and desktop: supported (same bundle, no Electron-only parts). Mobile: not supported; the
mobile app has no Files panel outline and shows nothing new. Remote: works over every
connection mode, because it only reads the file contents the Files panel already fetched over
the environment connection. Upstream T3 servers: fully supported, the feature is client-only
and is not gated on `loomFeatures`.

## Extension points used

- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (palette items). Create it if missing.
- [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (the `loom.file-outline.toggle` command), which requires [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root).
  Create both if missing.

[`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) must exist as the prerequisite of `ext-palette` (its client helper); create it
if missing. The packet registers nothing in it: no RPC, table or capability entry.

## Packet seams

- `apps/web/src/components/files/FilePreviewPanel.tsx`: one import, the header toggle, the
  outline column. Three marked seams. See [SEAMS.md](./SEAMS.md) for why the right-panel
  extension point cannot host this.

## Size

Small to medium: about 900 to 1,200 lines including tests. Most of it is the extractors.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
this folder in order: PRODUCT, TECHNICAL, SEAMS, IMPLEMENTATION, TESTING. Start with the
extractors and their tests (pure code, no UI), then the store, then the UI and the seams.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
