# L27 product

Selection: F4 in [selections.md](../../selections.md), first listed as not selected; confirmed
for this packet on 2026-09-24. Placement was left to this document, which decides it (below).

## Problem

While reviewing an agent's work Kyle often needs a quick transform: decode a JWT from a
log, base64-decode a header, check a SHA-256, convert a timestamp, read a cron expression,
generate a UUID or a password, compare two snippets. Today that means a browser tab to some
website (pasting secrets into a third-party page) or a shell one-liner. He wants these next
to the thread, offline, with nothing leaving the machine.

## What the user can do

- Open Utilities from the right panel launcher, the command palette ("Utilities..." submenu
  that lists every tool), or a keybinding they assign.
- Search tools by name or keyword ("jwt", "sha", "epoch", "slug", "regex", "subnet",
  "chmod"), or browse by category: Encode and decode, Hash, Generate, Convert, Text, Web.
- Test a regular expression against sample text and see every match and its groups
  highlighted live; a pattern that would hang stops after a second with an explanation.
- Work out a subnet: network, mask, usable range and host count for an IPv4 or IPv6 block,
  and whether an address is inside it.
- Convert file permissions between `rwxr-xr-x` and `755` by typing either or clicking a
  read, write, execute grid.
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
  separated by dots; this has 2.", "Invalid regular expression: unterminated group.",
  "255.255.0.255 is not a valid netmask."). The last valid output is not kept, to avoid
  showing stale results.
- **Regex stopped:** "Matching stopped after 1 second. The pattern may backtrack
  catastrophically on this text." The next edit runs again.
- **Warnings** shown with results where they matter: JWT decode "The signature is not
  verified."; MD5 and SHA-1 "Not suitable for security."; password strength estimate.
- **Large input:** inputs over 1 MiB are refused with "Input is larger than 1 MiB."
  Outputs are capped at 2 MiB with "Output truncated".
- **No search results:** "No tools match "<query>"."
- There is no loading state: every tool is synchronous except the diff view, which reuses
  upstream's diff renderer and shows its own lightweight placeholder while it lays out, and
  the regex tester, which shows "Matching..." only if its worker has not answered within
  200 ms.

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

## Decisions

- **Encode/decode collection confirmed (Kyle, 2026-09-27):** keep all six tools:
  Base64, URL encoding, HTML entities, JSON string escaping, Basic Auth headers and JWT
  decoding. Keep the text-focused scope; file-to-Base64 conversion and a binary/hex
  inspector are not additions to this packet. JWT remains decode-only, without signature
  verification. Preserve valid Unicode and meaningful whitespace through the selected
  transformation, explain invalid input, clear stale results, and provide examples and
  copy controls. Inputs remain local and unsaved as specified above.
- **Hashes collection confirmed (Kyle, 2026-09-27):** keep both the hash and HMAC
  calculators. Default to SHA-256, UTF-8 text input and hexadecimal output; retain the
  listed algorithm and encoding alternatives. Preserve the exact input, including
  whitespace and line endings, without silent trimming. HMAC keys remain local and
  unsaved. Uploaded-file hashing is outside this packet. Occasional use is sufficient
  value for these tools; frequent use is not a requirement for inclusion.
- **Generators collection confirmed (Kyle, 2026-09-27):** keep UUID, ULID, password,
  random token and Lorem ipsum. Use explicit Generate/Regenerate actions and copy controls,
  with bulk output where specified. Opening a tool or changing options does not generate
  or replace values automatically. Keep the last generated result with the options that
  produced it; indicate when edited options await regeneration. Generated values remain
  local and unsaved. UUID validation and ULID timestamp inspection can still update live.
- **Conversions collection confirmed (Kyle, 2026-09-27):** keep number bases, timestamps,
  colors, case conversion, cron explanations and chmod. Kyle expects to use all six often.
  Timestamps show UTC and local time together, clearly label seconds versus milliseconds,
  and expose an input-unit selector. Cron supports standard five-field syntax and the
  documented macros, names the local time zone used for its next five runs, and rejects
  unsupported dialects explicitly. It only explains schedules, never installs or runs one.
  chmod calculates permissions and a copyable command, never changes files. Keep live
  results and copy controls for these transformations.
- **Text collection confirmed (Kyle, 2026-09-27):** keep JSON formatting, list-to-JSON/CSV,
  text diff, slugify, text statistics and the regex tester. JSON key sorting, list trimming
  and dropping empty lines are explicit opt-in options. Diff compares exactly by default,
  with optional whitespace ignoring. Statistics distinguish character counts from bytes.
  Regex uses JavaScript syntax, highlights matches and capture groups, and stops matching
  after one second in its worker. Replacement previews remain outside scope.
- Client-only. No server, MCP or CLI. Agents do these things in a shell.
- **Web/network collection confirmed (Kyle, 2026-09-27):** keep the URL parser/editor,
  query string-to-JSON converter, user-agent parser and CIDR calculator. URL editing
  rebuilds a preview without navigating or sending requests. Query conversion preserves
  repeated parameters as arrays. User-agent results identify common browsers, operating
  systems and likely device categories, reporting unknown information rather than
  implying precise device identification. CIDR supports IPv4 and IPv6 ranges and address
  containment. All four run locally, without network scans or configuration changes.
- **Collection review complete (Kyle, 2026-09-27):** all six collections and all 29 tools
  are retained as one implement-now packet, with panel, palette and no-thread dialog
  access. The decisions above settle the collection review; implementation has not started.
- No new dependencies: the web app already ships `@noble/hashes` (hashes, HMAC, MD5 and
  SHA-1 through `@noble/hashes/legacy`), `jose` (`decodeJwt`, `decodeProtectedHeader`),
  `culori` (color spaces) and `@pierre/diffs` (diff rendering).
- Hand-written, tested implementations for the cron explainer, user-agent parser, ULID and
  UUID v7, kept deliberately small and honest about their limits (the UA parser names
  common browsers, engines and platforms; it is not a device database).
- 29 tools (Kyle): the original 26 plus a regex tester (native `RegExp`, live matches and
  groups), a CIDR/subnet calculator (range, mask, address in block) and a chmod calculator
  (rwx and octal both ways). All three are dependency-free.
- The regex tester runs matching in a Web Worker with a 1 second limit. JavaScript cannot
  interrupt a running regex, and a frozen tab is the one failure this panel must never cause.
- No BIP39 mnemonic generator (Kyle).
- No new dependencies, same as before the additions.
