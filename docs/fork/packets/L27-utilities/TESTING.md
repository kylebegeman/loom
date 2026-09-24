# L27 testing

Follow AGENTS.md: focused tests, no repo-wide checks, no sleeps. The tools are pure
functions with injected randomness and time, so every test is deterministic. Do not test
markup; test the tools' behavior and the registry's invariants.

## Automated tests

| File                                                 | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/utilities/tools/encode.test.ts`   | Base64 round trip on ASCII, emoji and CJK; URL-safe alphabet and missing padding decode; invalid character position; non-UTF-8 bytes fall back to hex with a warning. URL component vs full URL. HTML named and numeric entity decode, escape of all five characters. JSON string escape round trip. Basic auth header both ways, including a colon in the password. JWT: a known token decodes header and payload; `exp` in the past flags expired; two-part input gives the specific error; the "not verified" warning is always present. |
| `apps/web/src/fork/utilities/tools/hash.test.ts`     | Known vectors: MD5, SHA-1, SHA-256, SHA-384, SHA-512 of `""` and `"abc"`; HMAC-SHA256 RFC 4231 test case 1 and 2; hex and base64 output; key as hex and base64; MD5 and SHA-1 carry the security warning.                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/src/fork/utilities/tools/generate.test.ts` | With a seeded random source: UUID v4 has version 4 and variant bits; UUID v7 encodes the injected time and sorts by time; pasted UUID validation reports the version; ULID is 26 Crockford characters and its timestamp decodes; password length, required classes and look-alike exclusion; the picker's output distribution over a 62-character alphabet stays unbiased for a byte source that includes values above the limit; token byte counts per encoding; count caps.                                                               |
| `apps/web/src/fork/utilities/tools/convert.test.ts`  | Number base: big values beyond 2^64, prefixes, base 36, invalid digit error. Timestamp: seconds vs milliseconds detection, ISO back to seconds, with an injected `now` and a fixed time zone (`process.env.TZ` set in the test file, or format with `timeZone: "UTC"` in tests). Color: named, hex with alpha, `rgb()`, `hsl()`, `oklch()` inputs and each output format; invalid color error. Case: every style on `"XMLHttpRequest id2Value"`-style inputs.                                                                               |
| `apps/web/src/fork/utilities/tools/cron.test.ts`     | Descriptions for `* * * * *`, `*/15 * * * *`, `30 9 * * 1-5`, `0 0 1 * *`, `0 */2 * * *`, `@weekly`; month and weekday names; day-of-month and day-of-week "either matches" rule; next five runs from a fixed `now`, including across a month end and February 29; errors naming the field for `61 * * * *` and a four-field expression; `@reboot` error.                                                                                                                                                                                   |
| `apps/web/src/fork/utilities/tools/text.test.ts`     | JSON pretty, minify, sort keys, error with line and column; list to JSON and CSV with quoting of commas and quotes; slugify accents and separators; text stats on emoji (code points vs UTF-16 length) and bytes.                                                                                                                                                                                                                                                                                                                           |
| `apps/web/src/fork/utilities/tools/web.test.ts`      | URL parse and rebuild with edited parameters; query string with repeated keys to arrays and back; user agent table for current Chrome, Edge, Firefox, Safari on macOS and iOS, Samsung Internet on Android, and Googlebot; unknown string returns "Unknown".                                                                                                                                                                                                                                                                                |
| `apps/web/src/fork/utilities/tools/limits.test.ts`   | Input over 1 MiB (multibyte) refused; output truncation marker.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/web/src/fork/utilities/registry.test.ts`       | 26 tools; ids unique and kebab-case; every metadata entry has an implementation and vice versa; every tool with an `example` produces an `ok` result from it; every two-way tool round-trips its example through `swap`; search ranks prefix matches first; no source file under `tools/` references `crypto.subtle` or `randomUUID`.                                                                                                                                                                                                       |

Also run the extension point tests this packet adds entries to:
`apps/web/src/fork/panels/registry.test.ts` (letter U unique and not an upstream letter),
`packages/contracts/src/fork/keybindings.test.ts`, and the palette registry test
(values unique and prefixed `action:loom:`).

## Commands

```sh
vp test run apps/web/src/fork/utilities apps/web/src/fork/panels/registry.test.ts \
  packages/contracts/src/fork/keybindings.test.ts apps/web/src/fork/commandPalette
vp lint apps/web/src/fork packages/contracts/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/web typecheck
```

The keybinding list lives in `packages/contracts`, so also typecheck `t3` and
`@t3tools/client-runtime` if this packet created `ext-keybindings` or `ext-core`.

## Manual check

Ask Kyle before starting a dev server or a browser. With permission, on web and once on
desktop:

1. Open a thread, open the launcher, pick Utilities. Search "jwt", paste a JWT, check the
   decoded payload and the expiry line. Copy a field.
2. Base64: encode, Swap, decode; paste invalid input and read the error.
3. Hash "abc" with SHA-256 and compare with `printf abc | shasum -a 256`.
4. Cron `30 9 * * 1-5`: description and next runs in local time.
5. Diff two short snippets in split and unified views, light and dark theme.
6. Palette: Cmd K, "jwt", Enter opens the panel on JWT decode; the "Utilities..." submenu
   lists all tools.
7. Go to Settings (no active thread), use the palette item: the dialog opens; Escape closes
   it.
8. Bind `loom.utilities.open` and toggle with it.
9. Narrow the right panel under 480 px: the list and tool view stack with a back button.
10. From a second browser on the tailnet over plain `http`, hash, HMAC and generate a UUID.
11. Connect to an upstream T3 server: Utilities still works.
12. Reload: drafts are gone, recent tools remain.

## Merge safety

- Before review: the `git merge-tree` preview in SEAMS.md against the newest nightly tag.
- After Kyle merges to main: `scripts/fork/loom.sh integrate nightly --dry-run` from a clean,
  synced `main`. Record the result here.
