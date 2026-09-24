# L05 product

## Problem

When an agent points at a long file, or Kyle opens one from the Files panel to check its
work, there is no way to see the file's shape or jump to a function without scrolling. Old
Loom had a File Outline panel (P8) and it was used for exactly this. T3 Code's Files panel
shows highlighted, editable source but no structure.

## What the user can do

- Open the outline for the current file with the outline button in the file header, the
  command palette ("Toggle file outline") or a keybinding they assign.
- See the file's symbols in source order, indented by nesting: classes, structs, enums,
  protocols and interfaces, functions and methods, type aliases, top-level constants that
  hold functions, and Markdown headings.
- Type in the outline's filter box to narrow the list; Up and Down move, Enter jumps.
- Click a symbol to scroll the file to that line. The line is highlighted by the same reveal
  highlight upstream uses for file links.
- Keep the outline open while moving between files; it follows the active file.
- Edit the file and see the outline update a moment later.
- From the command palette, pick "Go to symbol in file" and choose a symbol from a searchable
  list, without opening the column.
- Close the outline with the same button, command or keybinding.

## Entry points

| Entry                                                                                                                                  | Behavior                                                                                                             | Way out                    |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| File header button (list icon, tooltip "Show outline" / "Hide outline")                                                                | Toggles the outline column. Shown only for a text file the outline supports.                                         | Same button.               |
| Command palette: "Toggle file outline"                                                                                                 | Same as the button. Listed only while a file surface is active in the current thread.                                | Same item.                 |
| Command palette: "Go to symbol in file"                                                                                                | Submenu of the active file's symbols; choosing one jumps.                                                            | Escape closes the palette. |
| Keybinding `loom.file-outline.toggle` (unbound by default, assignable in Settings, Keybindings, shown as "Loom: File Outline: Toggle") | Opens the column and focuses the filter; if open, closes it.                                                         | Same key.                  |
| Right panel launcher / "+" menu                                                                                                        | Not added. The outline lives inside the Files panel, not as its own tab (see TECHNICAL, "Why not a separate panel"). | n/a                        |
| Settings                                                                                                                               | None. The only preference is open or closed, remembered automatically.                                               | n/a                        |

The open or closed state is visible from the pressed state of the header button.

## States

- **Unsupported file type** (images, PDFs, media, CSV/TSV table view, attachments): the header
  button is hidden and the column is not rendered, even if the preference is "open".
- **Supported type, loading**: the column shows a small spinner while the file loads (the
  panel itself also shows one).
- **Empty**: "No symbols found in this file." with the language name, for example a JSON-like
  TS file with only imports.
- **Filter with no match**: "No symbols match "<query>"."
- **Truncated file** (over upstream's 1 MB preview limit): the outline covers the loaded part
  and shows "Outline covers the first 1 MB." at the top.
- **Too many symbols**: the first 2,000 are shown with "Showing the first 2,000 symbols."
- **Rendered Markdown**: clicking a heading switches the file to source view at that line
  (upstream's reveal already forces source view; see TECHNICAL).
- **Error**: extraction never throws to the UI; a failure in an extractor is caught, logged
  once, and shown as the empty state.
- **Server lacks Loom features**: not applicable; the outline is client-only.

## Surfaces and connection modes

- Web and desktop: supported.
- Mobile: not supported, nothing shown.
- Local, Tailscale, T3 Connect: identical, since the file text arrives through the Files
  panel's existing `projects.readFile` query.
- Upstream T3 server: supported.
- Upstream T3 Code opened on the same desktop profile: the fork's localStorage key is ignored;
  no effect.

## Copy

- Header button tooltip: "Show outline" / "Hide outline".
- Column heading: "Outline", with the symbol count.
- Filter placeholder: "Filter symbols".
- Palette: "Toggle file outline", "Go to symbol in file" (submenu placeholder "Search symbols
  in <file name>").
- Empty: "No symbols found in this file."
- Truncated: "Outline covers the first 1 MB."

## Decisions and open questions

Decisions:

- Client-only, like old Loom (its decision D7): no server RPC, works with upstream servers.
- Inside the Files panel, not a separate right panel tab: the right panel shows one surface at
  a time, so a separate Outline tab would hide the file it outlines.
- v1 uses fork-owned lightweight extractors (a comment- and string-aware scanner plus
  per-language declaration rules), no new dependency. Tree-sitter is deferred (TECHNICAL,
  "Parser choice").
- The keybinding ships unbound, per EXTENSION-POINTS.md (defaults leak into upstream's
  `keybindings.json`).

Questions for Kyle:

1. Approve `web-tree-sitter` plus grammar WASM files as a later phase if the lightweight
   extractors miss too much in practice? (Not needed for v1.)
2. Any languages beyond the brief's list worth adding in v1? Kotlin, Java, C# and Ruby are
   each about 40 lines with the same scanner.
