# L05 technical design

Implemented against released Orchestrator V2 integration `8781ba48a2` on 2026-10-04.

## Client-only boundary

The outline consumes the text already fetched by
[`FilePreviewPanel`](../../../../apps/web/src/components/files/FilePreviewPanel.tsx).
Editable source updates that query cache before the save completes, so the outline can
follow unsaved changes. It adds no RPC, migration, server capability, provider adapter or
production dependency. Only the fork keybinding command is added to contracts.

Web and desktop use the same implementation. Remote and upstream T3 servers work through
the existing file-read path. Mobile has no new UI. Palette items deliberately do not check
`loomFeatures`: this capability belongs to the client.

## Navigation identity

The seams pass `requestedPath`, which identifies the active right-panel surface. V2 can
resolve an absolute workspace link to a different `relativePath` for file reads. Publishing
that resolved path would hide palette actions and could create a second surface on jump.

Both the list and palette call upstream's `openFile(threadRef, path, line)`. Its reveal
request increments even when the selected line is unchanged. Upstream handles centering,
highlighting and switching rendered Markdown to source view. The outline uses the latest
reveal to mark the nearest preceding declaration, but does not track manual source scrolling.
Escape focuses the editable source inside its shadow root, with a focusable source wrapper
as the fallback for other file surfaces.

## Why the outline is inside Files

A separate right-panel surface would hide the source it outlines. Three insertion seams
place the toggle in the file header and the column before the explorer. A generic file-slot
registry is unnecessary for one consumer. If another packet needs this location, promote
these seams into a shared extension point then.

The column has a percentage width cap and no minimum width. When both navigation columns
are open, each is capped at 25%, preserving at least half the panel for source. Neutral
boundaries use existing product tokens.

## Extraction choice and limits

Fork-owned scanners mask comments and strings while retaining UTF-16 offsets and every
newline. Declaration rules walk type and module scopes, skip function bodies and unrelated
braces, and use indentation for Python. Go receiver methods are grouped under matching types.
Markdown extraction excludes front matter, fenced code and indented code.

The lightweight implementation avoids grammar downloads and new dependencies. It is an
outline heuristic, not a compiler or project-wide index. Parsing is bounded, nesting is
limited, and results stop at 2,000 symbols. Same-line overloads and accessors get distinct
IDs. Extractor failures yield a usable empty result and log once per path.

The column defers extraction and applies a 150 ms trailing debounce to edits. The palette
extracts only while opened. Both share a single-entry cache for the current `(path, contents)`.
Lists above 300 visible rows use the existing LegendList virtualizer; the palette already
virtualizes its symbol submenu and searches the full capped result.

## State and contextual commands

The Zustand store persists only `open` under `loom:file-outline:open:v1`. File text, source
references and focus requests remain transient. Storage failures fall back to an in-memory
preference. Header slots publish loaded sources by scoped thread key and remove them on
unmount or path changes.

Palette actions and the shortcut listener require a published source matching the active,
open file surface. They disappear for closed panels, inactive tabs, attachments, directories
and unsupported extensions. Stale palette actions check context again before running.
The shortcut listener unregisters outside that context, allowing the key to fall through.

## Conditional tree-sitter follow-up

Tree-sitter is outside this build. Start the approved conditional follow-up only when real
files expose omissions that cannot reasonably be fixed in the scanner. Add those files as
regression fixtures first. A grammar provider must preserve the extractor interface, load
lazily, fall back on scanner results when unavailable, and work in both web and desktop.
See [IMPLEMENTATION.md](./IMPLEMENTATION.md#conditional-tree-sitter-follow-up).
