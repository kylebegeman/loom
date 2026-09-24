# L27 product

Selection: F4 in [selections.md](../../selections.md) is listed under "Not selected"; Kyle
confirmed it for this packet in the 2026-09-24 brainstorm and left placement open. This
document decides placement (below).

## Problem

While reviewing an agent's work Kyle often needs a quick transform: decode a JWT from a
log, base64-decode a header, check a SHA-256, convert a timestamp, read a cron expression,
generate a UUID or a password, compare two snippets. Today that means a browser tab to some
website (pasting secrets into a third-party page) or a shell one-liner. He wants these next
to the thread, offline, with nothing leaving the machine.

## What the user can do

- Open Utilities from the right panel launcher, the command palette ("Utilities..." submenu
  that lists every tool), or a keybinding they assign.
- Search tools by name or keyword ("jwt", "sha", "epoch", "slug"), or browse by category:
  Encode and decode, Hash, Generate, Convert, Text, Web.
- Type or paste input and see the output update as they type; switch options (direction,
  algorithm, output encoding, case style) with plain controls.
- Copy any output field with one click; the button says "Copied" for a moment.
- Swap input and output for two-way tools (encode and decode) with one button.
- Load the tool's example to see what it does.
- Get recent tools at the top of the list.
- Use the same tools in a dialog when no thread is open.

## Placement decision

Right panel as the home, palette as the fast path, dialog as the fallback.

- A panel keeps the tool beside the thread, where the input usually comes from, and it keeps
  its state while the user switches back and forth. Upstream's surfaces already work this
  way.
- A settings page was rejected: utilities are not settings, and Settings replaces the chat.
- Palette actions alone were rejected: most tools need an input area and an output area.
- The palette submenu opens the panel on the chosen tool, so "Cmd K, jwt, Enter" is the
  whole path.

## Entry points

| Entry                             | Way in                                                                                                                                               | Way out                                                                           | Where the state shows        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------- |
| Right panel launcher and "+" menu | "Utilities" (launcher letter U)                                                                                                                      | Close the tab                                                                     | The tab, titled "Utilities"  |
| Command palette                   | "Utilities..." submenu, then a tool; or one of six direct actions ("Decode JWT", "Base64", "Hash text", "Generate UUID", "Unix time", "Format JSON") | Escape; close the tab                                                             | The panel opens on that tool |
| Keybinding                        | `loom.utilities.open`, unbound by default; bind it in Settings, Keybindings                                                                          | The same key closes the panel when it is the active surface, or closes the dialog | Panel or dialog              |
| No active thread                  | The palette item or keybinding opens a dialog                                                                                                        | Escape or the close button                                                        | The dialog                   |
| Chat, settings                    | None                                                                                                                                                 |                                                                                   |                              |

## States

- **Empty input:** the output area shows the tool's one-line description and an "Example"
  button.
- **Valid input:** output fields, each with a label and a Copy button.
- **Invalid input:** an inline message under the input in the error color, specific to the
  tool ("Not valid base64: unexpected character at position 12.", "A JWT has three parts
  separated by dots; this has 2."). The last valid output is not kept, to avoid showing
  stale results.
- **Warnings** shown with results where they matter: JWT decode "The signature is not
  verified."; MD5 and SHA-1 "Not suitable for security."; password strength estimate.
- **Large input:** inputs over 1 MiB are refused with "Input is larger than 1 MiB."
  Outputs are capped at 2 MiB with "Output truncated".
- **No search results:** "No tools match "<query>"."
- There is no loading state: every tool is synchronous except the diff view, which reuses
  upstream's diff renderer and shows its own lightweight placeholder while it lays out.

## Surfaces and connection modes

- Web and desktop: full.
- Mobile: not available.
- Any environment, including upstream T3 servers and plain-`http` remote browsers: works,
  because nothing runs on the server and no tool depends on secure-context-only browser
  APIs.

## Privacy

- Inputs and outputs live only in memory for the life of the page. They are not written to
  localStorage, not sent to the server, not logged, and not included in telemetry.
- Only the list of recently used tool ids is stored (`loom:utilities:recent:v1`).
- Generators use `crypto.getRandomValues`, never `Math.random`.

## Decisions and open questions

Decisions:

- Client-only. No server, MCP or CLI. Agents do these things in a shell.
- No new dependencies: the web app already ships `@noble/hashes` (hashes, HMAC, MD5 and
  SHA-1 through `@noble/hashes/legacy`), `jose` (`decodeJwt`, `decodeProtectedHeader`),
  `culori` (color spaces) and `@pierre/diffs` (diff rendering).
- Hand-written, tested implementations for the cron explainer, user-agent parser, ULID and
  UUID v7, kept deliberately small and honest about their limits (the UA parser names
  common browsers, engines and platforms; it is not a device database).

Open questions for Kyle:

1. Any tool from the old list worth adding beyond the 26 (for example a BIP39 mnemonic
   generator, which old Loom faked with a small word list and this packet drops)?
