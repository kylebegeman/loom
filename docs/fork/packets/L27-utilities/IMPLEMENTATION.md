# L27 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. No test data or server is needed until the manual check.

## File layout

```
apps/web/src/fork/utilities/
  types.ts
  registry-meta.ts        ids, labels, categories, keywords, descriptions (no implementations)
  registry.ts             UTILITY_TOOLS (meta + run), searchTools
  tools/encode.ts         base64, url, html, json-string, basic-auth, jwt
  tools/hash.ts           hash, hmac
  tools/generate.ts       uuid, ulid, password, token, lorem
  tools/convert.ts        number-base, timestamp, color, case
  tools/chmod.ts          chmod parse and format
  tools/cron.ts           cron parser, describer, next runs
  tools/text.ts           json, list, slug, count
  tools/regexMatch.ts     regex matching (pure; used by the worker), pattern and flag validation
  tools/web.ts            url-parse, query, user-agent
  tools/cidr.ts           IPv4 and IPv6 parsing, block math, contains
  tools/limits.ts         byte-size check, output truncation
  tools/*.test.ts         one test file per tools file
  registry.test.ts
  store.ts
  regexWorker.ts  regexRunner.ts   worker entry; createRegexRunner (timeout, restart)
  UtilitiesView.tsx  ToolList.tsx  ToolView.tsx  DiffToolView.tsx  RegexView.tsx  ChmodView.tsx
  panel.tsx  UtilitiesDialogHost.tsx  palette.tsx  open.ts
docs/fork/user/utilities.md
```

## Steps

1. **Extension points.** Existence checks for `ext-core` (only for its client helper, see
   SEAMS.md), `ext-panels`, `ext-palette`, `ext-web-root`, `ext-keybindings`; create missing
   ones in their own commits.

2. **Types and limits.** `types.ts` from TECHNICAL.md; `limits.ts`:

   ```ts
   export const MAX_INPUT_BYTES = 1024 * 1024;
   export const MAX_OUTPUT_CHARS = 2 * 1024 * 1024;
   const encoder = new TextEncoder();
   export const inputTooLarge = (text: string) =>
     text.length > MAX_INPUT_BYTES / 4 && encoder.encode(text).byteLength > MAX_INPUT_BYTES;
   export const capOutput = (value: string) =>
     value.length <= MAX_OUTPUT_CHARS
       ? value
       : `${value.slice(0, MAX_OUTPUT_CHARS)}\n... Output truncated`;
   ```

3. **Tools, test first, one category at a time.** Each tool is a pure `run`. Sketches of
   the ones that are easy to get wrong:

   ```ts
   // base64 decode: accept both alphabets and missing padding, report invalid UTF-8.
   export function decodeBase64(text: string): UtilityResult {
     const cleaned = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
     const bad = cleaned.search(/[^A-Za-z0-9+/=]/);
     if (bad !== -1) return error(`Not valid base64: unexpected character at position ${bad + 1}.`);
     const padded = cleaned.padEnd(Math.ceil(cleaned.length / 4) * 4, "=");
     const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
     try {
       return ok([
         { label: "Text", value: new TextDecoder("utf-8", { fatal: true }).decode(bytes) },
       ]);
     } catch {
       return ok(
         [{ label: "Hex", value: toHex(bytes), monospace: true }],
         ["The bytes are not UTF-8 text; showing hex."],
       );
     }
   }

   // UUID v7: 48-bit Unix ms timestamp, version 7, variant 10, rest random.
   export function uuidV7(random: (n: number) => Uint8Array, now: number): string {
     const b = random(16);
     const ms = BigInt(now);
     for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
     b[6] = (b[6]! & 0x0f) | 0x70;
     b[8] = (b[8]! & 0x3f) | 0x80;
     return formatUuid(b);
   }

   // Unbiased pick from an alphabet by rejection sampling.
   export function pick(
     alphabet: string,
     count: number,
     random: (n: number) => Uint8Array,
   ): string {
     const limit = 256 - (256 % alphabet.length);
     let out = "";
     while (out.length < count) {
       for (const byte of random(count * 2)) {
         if (byte < limit) out += alphabet[byte % alphabet.length];
         if (out.length === count) break;
       }
     }
     return out;
   }
   ```

   Cron: parse each of the five fields into a sorted set of allowed values (minute 0-59,
   hour 0-23, day of month 1-31, month 1-12 with `JAN`..`DEC`, day of week 0-7 with
   `SUN`..`SAT`, 7 folded to 0), supporting `*`, `a-b`, `a,b`, `*/n`, `a-b/n` and the macros
   `@yearly @annually @monthly @weekly @daily @midnight @hourly`. Description: build from the
   sets ("At 09:30, Monday through Friday", "Every 15 minutes", "At minute 0 past every 2nd
   hour"). Next runs: step minute by minute from now with day skipping, capped at 4 years of
   search, applying the standard rule that when both day of month and day of week are
   restricted, a day matches if either matches. `@reboot` returns an error "Not a
   time-based schedule."

   Regex: `tools/regexMatch.ts` validates flags (only `dgimsuvy`, each at most once, not
   both `u` and `v`) and compiles the pattern for `run`; `matchAll` there does the matching
   for the worker. `regexRunner.ts`:

   ```ts
   export function createRegexRunner(makeWorker: () => Worker, timeoutMs = 1000) {
     let worker: Worker | null = null;
     let nextId = 0;
     return {
       run(request: RegexRequest): Promise<RegexResponse> {
         worker ??= makeWorker();
         const id = ++nextId;
         const current = worker;
         return new Promise((resolve) => {
           const timer = setTimeout(() => {
             current.terminate();
             if (worker === current) worker = null;
             resolve({ kind: "timeout" });
           }, timeoutMs);
           current.onmessage = (event) => {
             if (event.data.requestId !== id) return; // a stale answer
             clearTimeout(timer);
             resolve(event.data.response);
           };
           current.postMessage({ requestId: id, ...request });
         });
       },
       dispose() {
         worker?.terminate();
         worker = null;
       },
     };
   }
   ```

   `RegexView` creates it with `() => new RegexWorker()` from
   `import RegexWorker from "./regexWorker.ts?worker"`, debounces 150 ms, ignores results
   for superseded requests, and disposes on unmount.

   CIDR: parse to `{ version: 4 | 6, address: bigint, prefix: number }`; mask =
   `((1n << bits) - 1n) ^ ((1n << (bits - prefix)) - 1n)`; network = address AND mask;
   last = network OR NOT mask within the width. IPv4 usable range excludes network and
   broadcast except for /31 (both usable, RFC 3021) and /32 (one host). IPv6 has no
   broadcast; every address counts.

   chmod: parse to a 12-bit number; format octal (4 digits when a special bit is set, else
   3), symbolic (`s`/`S`, `t`/`T` for the special bits), and the per-class sentence.
   `ChmodView` toggles bits and writes the octal form back to the input.

   User agent: an ordered table of `{ test: RegExp, browser, versionGroup }` for Edge,
   Opera, Samsung Internet, Firefox, Chrome, Safari, plus engines (Blink, Gecko, WebKit),
   OS (Windows NT mapping, macOS, iOS, iPadOS hint, Android, Linux, ChromeOS) and bots
   (`/bot|crawler|spider|slurp/i`). Order matters: Edge and Opera before Chrome, Chrome
   before Safari.

4. **Registry and store.** `registry-meta.ts` exports metadata only; `registry.ts` joins
   metadata with implementations. `store.ts` as in TECHNICAL.md.

5. **Views.** `ToolView.tsx` renders from the definition: textarea(s) using upstream's
   `Textarea` (`apps/web/src/components/ui/textarea.tsx`), options with `Select`, `Switch`,
   `NumberField`, `Input` (`secret: true` renders a password input), outputs as read-only
   monospace blocks with Copy (`useCopyToClipboard`). Swap and Example buttons. Warnings
   in muted text, errors in the destructive color. `DiffToolView.tsx` wraps
   `MultiFileDiff` (check the `FileContents` shape in
   `node_modules/@pierre/diffs/dist/types.d.ts`; it carries a name and the contents).
   `RegexView.tsx` and `ChmodView.tsx` as above. `UtilitiesView.tsx` does search,
   categories, recents and the responsive list and detail layout.

6. **Panel, dialog, palette, command.**

   ```ts
   // open.ts
   export function openUtilities(toolId: string, threadRef: ScopedThreadRef | null) {
     useUtilitiesStore.getState().select(toolId);
     rememberRecent(toolId);
     if (threadRef)
       useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface("utilities"));
     else useUtilitiesStore.getState().openDialog(toolId);
   }
   ```

   `panel.tsx` lazy-loads `UtilitiesView`. `UtilitiesDialogHost.tsx` renders the dialog only
   when open and listens for `loom.utilities.open`. `palette.tsx` imports `registry-meta.ts`
   only and returns the submenu plus six root actions (TECHNICAL.md, Web wiring).
   Append `"loom.utilities.open"` to `FORK_KEYBINDING_COMMANDS`.

7. **Docs.** `docs/fork/user/utilities.md`: how to open it, that everything runs locally and
   nothing is saved, that JWT signatures are not verified, the cron dialect, that the regex
   tester uses JavaScript's regex syntax and stops a match after 1 second, and that the CIDR
   calculator handles IPv4 and IPv6. Set the
   packet index Status.

## Pitfalls

- Do not use `crypto.subtle` or `crypto.randomUUID` (see TECHNICAL.md, Secure-context
  constraint). A lint-free way to enforce it: a test that greps the `tools/` sources.
- `atob` works on Latin-1; always go through bytes and `TextDecoder` for UTF-8.
- `BigInt` parsing of `0x`-prefixed input: strip the prefix and parse digit by digit for
  bases other than 10; `BigInt("0x...")` alone rejects uppercase `0X` in some engines.
- `JSON.parse` error positions differ between engines; compute line and column from the
  message's position when present, otherwise show the message as is.
- Keep `palette.tsx` free of implementation imports so the palette stays light.
- Do not store drafts in localStorage, even "for convenience".
- Never run a user regex on the main thread, not even "just to count matches"; only
  compiling it there is safe.
- `String.prototype.matchAll` throws without the `g` flag; use `exec` once in that case.
- A zero-length match (for example `a*` on `bbb`) must advance, or the loop never ends;
  `matchAll` handles it, a hand-written `exec` loop must bump `lastIndex`.
- IPv4 parsing must reject `01.2.3.4` style octets rather than read them as octal, and
  `256` or more in any octet.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done) (the
server and `loomFeatures` items do not apply), plus:

- All 29 tools pass their tests, including round trips for every two-way tool.
- `(a+)+$` against 40 `a`s followed by `b` in the regex tester stops after about a second
  with the message, the page stays responsive, and the next pattern works.
- The panel, the palette submenu and root actions, the dialog without a thread, and the
  keybinding all open the right tool.
- A remote browser on plain `http` over Tailscale can hash, HMAC and generate UUIDs.
