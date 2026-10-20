# Utilities

**Utilities** is a set of small developer tools that run in your browser: encode and decode,
hash, generate IDs and passwords, convert numbers, times and colors, explain cron schedules,
format JSON, diff text, test regular expressions and work out network blocks. Use them beside
a thread without opening another app or pasting into a website.

## Opening Utilities

- **Right panel:** pick **Utilities** in the launcher (letter U) or the panel picker.
- **Command palette:** **Utilities...** lists every tool. Six tools also have their own
  entry: **Decode JWT**, **Base64**, **Hash text**, **Generate UUID**, **Unix time** and
  **Format JSON**. Picking one opens the panel on that tool.
- **Keybinding:** `loom.utilities.open` has no key by default. Assign one in **Settings,
  Keybindings**. The key opens Utilities on the last tool you used and closes it again when
  it is already showing.

With no thread open, for example in Settings, the palette entries and the keybinding open
Utilities in a dialog instead. Escape closes it.

Search the tool list by name or keyword, such as "jwt", "sha", "epoch", "slug" or "subnet".
Tools you used recently appear first. **Example** fills in a sample input, and **Swap** turns
an encoder around so its output becomes the input for decoding. Every output has a **Copy**
button.

## Privacy

Everything runs on your device. Nothing you type is sent to the server, written to disk or
logged, so Utilities works the same on any server, including T3 Code servers and remote
browsers over plain `http`. What you typed is kept while the page is open, so you can switch
threads and come back; reloading clears it. Only the list of recently used tools is saved.

Generators use the browser's cryptographic random source.

## Things to know

- **JWT decode** shows the header and claims and checks the time claims, but it does not
  verify the signature. A decoded token is not proof that it is genuine.
- **MD5 and SHA-1** are offered for checksums and older systems. They are not suitable for
  security.
- **Cron explainer** reads the standard five fields (minute, hour, day of month, month, day of
  week), with lists, ranges, steps, month and weekday names, and the macros `@yearly`,
  `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight` and `@hourly`. Quartz and Jenkins
  extensions such as `?`, `L`, `W`, `#`, `H` and a seconds field are not supported. When both
  day fields are set, the schedule runs when either one matches. The next five runs are in
  your local time zone. Around daylight saving changes, a time that does not exist that day is
  skipped and a time that happens twice runs once; some cron daemons behave differently.
- **Regex tester** uses JavaScript's regular expression syntax and flags. It stops a match
  after 1 second, so a pattern that backtracks badly cannot freeze the app. Edit the pattern
  or the text to try again.
- **CIDR calculator** handles IPv4 and IPv6 blocks and can check whether an address is inside
  one.
- Inputs over 1 MiB are refused, and very long outputs are cut off with a note.
