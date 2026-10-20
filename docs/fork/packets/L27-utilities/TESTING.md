# L27 testing

Follow AGENTS.md: focused tests, no repo-wide checks, no sleeps. The tools are pure
functions with injected randomness and time, so every test is deterministic. Do not test
markup; test the tools' behavior and the registry's invariants.

## Automated tests

| File                                                               | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/utilities/tools/encode.test.ts`                 | Base64 round trip on ASCII, emoji and CJK; URL-safe alphabet and missing padding decode; invalid character position; non-UTF-8 bytes fall back to hex with a warning. URL component vs full URL. HTML named and numeric entity decode, escape of all five characters. JSON string escape round trip. Basic auth header both ways, including a colon in the password. JWT: a known token decodes header and payload; `exp` in the past flags expired; two-part input gives the specific error; the "not verified" warning is always present. |
| `apps/web/src/fork/utilities/tools/hash.test.ts`                   | Known vectors: MD5, SHA-1, SHA-256, SHA-384, SHA-512 of `""` and `"abc"`; HMAC-SHA256 RFC 4231 test case 1 and 2; hex and base64 output; key as hex and base64; MD5 and SHA-1 carry the security warning.                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/src/fork/utilities/tools/generate.test.ts`               | With a seeded random source: UUID v4 has version 4 and variant bits; UUID v7 encodes the injected time and sorts by time; pasted UUID validation reports the version; ULID is 26 Crockford characters and its timestamp decodes; password length, required classes and look-alike exclusion; the picker's output distribution over a 62-character alphabet stays unbiased for a byte source that includes values above the limit; token byte counts per encoding; count caps.                                                               |
| `apps/web/src/fork/utilities/tools/convert.test.ts`                | Number base: big values beyond 2^64, prefixes, base 36, invalid digit error. Timestamp: seconds vs milliseconds detection, ISO back to seconds, with an injected `now` and a fixed time zone (`process.env.TZ` set in the test file, or format with `timeZone: "UTC"` in tests). Color: named, hex with alpha, `rgb()`, `hsl()`, `oklch()` inputs and each output format; invalid color error. Case: every style on `"XMLHttpRequest id2Value"`-style inputs.                                                                               |
| `apps/web/src/fork/utilities/tools/cron.test.ts`                   | Descriptions for `* * * * *`, `*/15 * * * *`, `30 9 * * 1-5`, `0 0 1 * *`, `0 */2 * * *`, `@weekly`; month and weekday names; day-of-month and day-of-week "either matches" rule; next five runs from a fixed `now`, including across a month end and February 29; errors naming the field for `61 * * * *` and a four-field expression; `@reboot` error.                                                                                                                                                                                   |
| `apps/web/src/fork/utilities/tools/text.test.ts`                   | JSON pretty, minify, sort keys, error with line and column; list to JSON and CSV with quoting of commas and quotes; slugify accents and separators; text stats on emoji (code points vs UTF-16 length) and bytes.                                                                                                                                                                                                                                                                                                                           |
| `apps/web/src/fork/utilities/tools/web.test.ts`                    | URL parse and rebuild with edited parameters; query string with repeated keys to arrays and back; user agent table for current Chrome, Edge, Firefox, Safari on macOS and iOS, Samsung Internet on Android, and Googlebot; unknown string returns "Unknown".                                                                                                                                                                                                                                                                                |
| `apps/web/src/fork/utilities/tools/regexMatch.test.ts`             | Flags validation (unknown flag, duplicate, `u` with `v`); syntax error message from `run`; matches with index and end; numbered and named groups, including unmatched optional groups as undefined; `d` flag indices; without `g` only the first match; zero-length matches advance (`a*` on `bbb`); the 1,000 match cap sets `truncated`.                                                                                                                                                                                                  |
| `apps/web/src/fork/utilities/regexRunner.test.ts`                  | With a fake worker (an object with `postMessage`, `terminate` and `onmessage`): a reply resolves the request; no reply within the timeout (controlled with Vitest fake timers, not real waiting) terminates that worker, resolves `timeout`, and the next run creates a new worker; supersession and disposal settle pending promises and clear timers; an old timeout cannot terminate a new worker; stale replies are ignored; worker construction, postMessage, worker-error and message-error failures recover on the next request.     |
| `apps/web/src/fork/utilities/tools/cidr.test.ts`                   | `10.0.0.0/8`, `192.168.1.10/24` (host bits reported, network 192.168.1.0), `192.168.1.0 255.255.255.0`, non-contiguous netmask error, `/31` and `/32` usable counts, `/0`; IPv6 `2001:db8::/32` range and compressed output, `::1/128`, embedded IPv4 `::ffff:192.0.2.1`; contains yes and no at both ends of the block; invalid octets (`256`, `01`) and prefixes (`/33`, `/129`) rejected.                                                                                                                                                |
| `apps/web/src/fork/utilities/tools/chmod.test.ts`                  | `755`, `0644`, `4755`, `1777`, `2750` to symbolic and back; `rwxr-xr-x` and `-rwsr-xr-x` to octal; `S` and `T` for special bits without execute; per-class sentence; invalid input (`8`, `rwxrwxrw`, 5 digits) errors.                                                                                                                                                                                                                                                                                                                      |
| `apps/web/src/fork/utilities/tools/limits.test.ts`                 | UTF-8 input limit at and above 1 MiB; output at most 2 MiB including the truncation marker; multibyte boundaries remain valid.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/web/src/fork/utilities/registry.test.ts`                     | 29 tools; ids unique and kebab-case; every metadata entry has an implementation and vice versa; every tool with an `example` produces an `ok` result from it; every two-way tool round-trips its example through `swap`; search ranks prefix matches first.                                                                                                                                                                                                                                                                                 |
| `apps/web/src/fork/utilities/UtilitiesView.focus.browser.test.tsx` | In headless Chromium. Stacked at 380 px: search and Enter moves focus to the tool's heading, and "All tools" moves it to that tool in the list. Side by side at 640 px: clicking a tool leaves focus on it. The no-thread dialog's frame shows before the view's chunk loads, focus then moves to the tool's heading, and Escape closes it and returns focus to the element focused before. A palette-style dialog over it that switches the tool as it closes leaves focus on the new tool's heading, inside the dialog.                   |

Also run the extension point tests this packet adds entries to:
`apps/web/src/fork/panels/registry.test.ts` (letter U unique and not an upstream letter),
`packages/contracts/src/fork/keybindings.test.ts`, and the palette registry test
(values unique and prefixed `action:loom:`).

Test hashes, HMAC and generators with `crypto.subtle` and `crypto.randomUUID` unavailable.
The browser pass verifies actual worker isolation and responsiveness.

Verify conversion controls: timestamps have an explicit seconds/milliseconds selector and
show both labeled UTC and local results. Cron displays the local time-zone name used for
the next runs and rejects unsupported field counts or dialect syntax. Include daylight-saving
transitions in next-run fixtures so displayed results agree with the documented local-time
semantics. The cron and chmod tools never execute the schedules or commands they display.

Verify generator interaction: opening or remounting a tool does not generate values;
Generate creates output; editing options preserves that output and marks it as awaiting
regeneration; Regenerate applies the new options. Copy always copies the displayed value.

## Commands

```sh
vp test run packages/contracts/src/fork/keybindings.test.ts
(cd apps/web && vp test run --project unit --project browser src/fork/utilities \
  src/fork/panels/registry.test.ts src/fork/commandPalette)
vp lint apps/web/src/fork packages/contracts/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/web typecheck
```

The web tests run from `apps/web` because the focus test needs its `browser` project; the
repository root runs it in the Node pool, where it fails to load.

The keybinding list changes in `packages/contracts`; typecheck its affected consumers,
including server, client-runtime and mobile, even though the extension point already exists.

## Manual check

Ask Kyle before starting a dev server or a browser. With permission, on web and once on
desktop:

1. Open a thread, open the launcher, pick Utilities. Search "jwt", paste a JWT, check the
   decoded payload and the expiry line. Copy a field.
2. Base64: encode, Swap, decode; paste invalid input and read the error.
3. Hash "abc" with SHA-256 and compare with `printf abc | shasum -a 256`.
4. Cron `30 9 * * 1-5`: description and next runs in local time.
5. Diff two short snippets in split and unified views, light and dark theme.
6. Regex tester: `(\w+)@(?<host>[\w.]+)` on a few addresses shows matches, numbered and named
   groups, and highlights. Then `(a+)+$` on 40 `a`s and a `b`: the stop message appears after
   about a second and typing stays responsive.
7. CIDR `192.168.1.10/24` with "Address to check" `192.168.2.1`: network 192.168.1.0,
   254 usable, not contained. chmod: click the grid to build `rwxr-x---`, the input shows 750.
8. Palette: Cmd K, "jwt", Enter opens the panel on JWT decode; the "Utilities..." submenu
   lists all tools.
9. Go to Settings (no active thread), use the palette item: the dialog opens with focus on
   the tool's heading; Escape closes it and returns focus to where it was.
10. Bind `loom.utilities.open` and toggle with it.
11. Narrow the right panel under 480 px: the list and tool view stack with a back button.
    Picking a tool moves focus to its heading, and the back button moves it to that tool in
    the list.
12. From a second browser on the tailnet over plain `http`, hash, HMAC, generate a UUID and
    run the regex tester (workers need no secure context).
13. Connect to an upstream T3 server: Utilities still works.
14. Reload: drafts are gone, recent tools remain.

## Merge safety

- Before review: the `git merge-tree` preview in SEAMS.md against the newest nightly tag.
- After Kyle merges to main: `scripts/fork/loom.sh integrate nightly --dry-run` from a clean,
  synced `main`. Record the result here.

## Results

Run on 2026-10-20 after rebasing onto `main` (`147e83e3f6`), before landing.

- **Tests:** 20 files and 696 tests, all passing. Tool files:
  encode 83, convert 77, web 69, cron 67, chmod 62, text 60, generate 45, cidr 37,
  hash 31, regexMatch 31, limits 14, bytes 12, time 6. Also regexRunner 22, registry 45 and
  runtime 2, plus the extension point tests (panels 6, palette 24, keybindings 3).
- **Review:** every tool family was written by one agent and then reviewed adversarially by a
  second agent, which checked vectors against `shasum`, `md5`, `node:crypto`, native
  `decodeURI`, cronie's source and Python's `ipaddress`, fuzzed round trips, and timed 1 MiB
  inputs. The reviews fixed quadratic regexes in the timestamp, case and CIDR parsers,
  daylight-saving resolution, JWT decoding that differed between browsers and Node, stack
  overflow on deeply nested JWT payloads, silent U+FFFD substitution in hashes, and cron
  weekday ranges ending on Sunday. Each fix has a regression test.
- **React Compiler coverage:** `apps/web/src/reactCompilerCoverage.test.ts` compiles all 32
  `fork/utilities` files. The run reports 76 failures, all in files this packet does not
  touch (for example `components/NoProjectsHero.tsx` and `fork/code-graph/parts.tsx`).
- **Lint:** `vp lint apps/web/src/fork packages/contracts/src/fork` reports nothing.
- **Typecheck:** contracts, web, server, client-runtime and mobile all pass on the tree
  rebased onto `main`.
- **Manual check:** run later the same day, after landing; see the next section.

### Manual pass

Run on 2026-10-20 on web, at `e970ee0c25` and then with the fixes below, in the T3 Browser
panel (Chrome 154) against a dev server in the packet worktree: `vp run dev` on the
worktree's ignored `.t3`, seeded with `vp run migrate-dev-db`. By step:

1. JWT: `Uint8Array.fromBase64` exists in this browser, so `jose` took its native path. A
   URL-safe token whose payload holds `?>?>`, a padded token, and tokens with a future and a
   past `exp` all decoded. The past one read "The token has expired.", every token showed
   "The signature is not verified.", and a two-part token gave the specific error. Copy
   Payload wrote exactly the displayed JSON, checked by wrapping
   `navigator.clipboard.writeText`.
2. Base64: `Hello, 世界 👋` encoded to `SGVsbG8sIOS4lueVjCDwn5GL`, Swap decoded it back, and
   invalid input read "Not valid base64: unexpected character at position 4."
3. SHA-256 of `abc` gave
   `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`, the same as
   `shasum -a 256`.
4. Cron `30 9 * * 1-5`: "At 09:30, Monday through Friday", with next runs labeled
   America/New_York and shown in EDT.
5. Diff: unified and split views in the light and dark themes.
6. Regex: the address pattern showed its matches with numbered and named groups. `(a+)+$` on
   40 `a`s and a `b` stopped after 1.18 s with the backtracking message. During the run the
   longest main-thread gap was 13 ms and a keystroke landed in 1 ms, so matching ran off the
   main thread. The next run answered 166 ms later on a fresh worker.
7. CIDR: host bits reported, network 192.168.1.0/24, 254 usable, `192.168.2.1` not in the
   block. chmod: the grid built `rwxr-x---` and the input read 750.
8. Palette: "jwt" and Enter opened the panel on JWT decode; the submenu listed all 29 tools.
9. Settings: the palette item opened the dialog and Escape closed it. **Fixed:** the first
   open after a page load focused Close, because the dialog picked its initial focus while
   the lazy tool view was still loading. The frame and a loading line now show at once with
   focus on the dialog, and focus moves to the tool's heading when the view arrives, 347 ms
   after a first open from Settings. **Fixed after review:** picking another tool from the
   palette while the dialog was open sent focus behind the modal, because the palette
   returned it to the old tool's heading, which the switch had removed. The heading now
   stays mounted across tool switches, and focus lands on the new tool's heading inside the
   dialog. Escape and the shortcut return focus to where it was.
10. With `mod+alt+u` bound in the worktree's `.t3/userdata/keybindings.json` (dev data only),
    the shortcut toggled the dialog in Settings and the panel in a thread.
11. Layout: list and tool side by side at a 539 px panel width and wider, stacked at 383 px
    with no horizontal scroll. **Fixed:** stacked, picking a tool or pressing "All tools"
    hid the focused control and focus fell to the page. Focus now moves to the tool's
    heading or to that tool in the list. Side by side it stays where it was. Rechecked at
    377 px after the heading moved out of the tool view: both moves still land, and the
    spacing is unchanged.
12. Remote http: below.
13. Not run: no upstream T3 server was available. The feature is client-only and has no
    `loomFeatures` gate, so it does not depend on which server it connects to.
14. Reload: drafts were cleared and recent tools remained.

Remote http. The dev web server listens on loopback only, `vp run dev --share` serves HTTPS,
and Vite's `allowedHosts` rejects the Mac's LAN hostname, so no hostname origin was
reachable. A TCP forwarder, started for this pass and stopped after it, forwarded the dev
port to the Mac's LAN address over plain `http`, opened after pairing in an incognito T3
Browser profile on the same Mac. There `isSecureContext` was false and `crypto.subtle` and
`crypto.randomUUID` were undefined. SHA-256 of `abc` and HMAC-SHA-256 RFC 4231 case 2
matched their vectors, UUID generated a v4 value, and the regex tester matched. `(a+)+$`
stopped after 1.16 s with a longest main-thread gap of 32 ms, and a flag typed during the
run applied. This covers plain `http` on a non-loopback origin, not a second device.

Fixes and checks. Besides the focus fixes, the new test exposed an import cycle: `open.ts`
and `panel.tsx` imported each other through the panel registry, so importing `open.ts` first
read `UTILITIES_PANEL_ID` before it was set. The constant now lives in `panel.tsx`. An
adversarial review of the fixes found the palette case in step 9, and that the first fix,
which made the whole dialog wait for the view, delayed its first appearance by at least
300 ms, React's reveal throttle. Both are fixed as step 9 describes, and their cases in
`UtilitiesView.focus.browser.test.tsx` failed before the fixes. With them, the commands
above ran 21 files and 700 tests, all passing, and lint and the web typecheck pass.

Not run: the desktop pass.
