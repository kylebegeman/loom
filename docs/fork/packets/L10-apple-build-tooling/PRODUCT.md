# L10 product

## Problem

Kyle builds Swift apps (SwiftUI, TCA, XcodeGen) with agents. Today an agent runs
`xcodebuild` in its shell, pages through thousands of log lines, and often misreads which
test failed. Kyle cannot see what was built, for which destination, or whether the XcodeGen
spec and the committed project drifted, without opening Xcode. Old Loom had an "Apple" area
of about 9,000 lines, but it only planned commands ("Commands: Planned") and its XCResult
summary read the wrong JSON fields. This packet makes the small, real version: run, record,
summarize.

## What the user can do

- Open the **Apple build** panel from the right panel launcher, the "+" menu, the command
  palette or a keybinding.
- See the toolchain at a glance: Xcode version, whether first-launch setup is pending, the
  simulator runtimes, and which helpers (`xcodegen`, `xcbeautify`) are installed.
- Pick a container (workspace, project, XcodeGen spec or package), a scheme, a configuration
  and a destination. The choice is remembered per project on this client.
- **Build**, **Test** (optionally one test plan, or only the selected tests), **Build and
  run** on a simulator, a connected device or this Mac, and **Release build**.
- **Build and run on an iPhone or iPad.** Paired physical devices (from `xcrun devicectl`)
  appear under "Devices" in the destination picker. Loom builds with the project's own signing
  settings, installs and launches the app. When signing is not set up, the run fails with
  "Code signing is not set up for this scheme. Open the project in Xcode, choose a team under
  Signing & Capabilities, then build again." Loom never creates, downloads or changes
  certificates or provisioning profiles. A device that is not paired, or has Developer Mode
  off, is listed but disabled with the fix ("Pair it in Xcode, Window > Devices and
  Simulators", "Turn on Developer Mode on the device, Settings > Privacy & Security").
- **Swift packages.** A folder with a `Package.swift` gets **Build** (`swift build`) and
  **Test** (`swift test`). Errors and warnings are listed with file and line, and test results
  (XCTest and Swift Testing) show totals and each failure, with "Test only this".
- Watch the live log (beautified when `xcbeautify` is installed) and cancel a run.
- Read the result as a summary: status, duration, errors and warnings with file and line,
  test totals and each failure's message. Copy a failure, or add the summary to the composer
  as context for the agent.
- Browse the project's recent runs (the last 20 by default; the number is a setting, 5 to
  200), reopen any summary, and open the log file or the `.xcresult` bundle in Xcode (desktop,
  same machine) or download the log.
- For an XcodeGen project: see "In sync", "Out of date" or "Spec invalid", view the
  `project.pbxproj` diff, and **Generate** to update the project.
- Run the **Release readiness** checklist: bundle id, version and build number, signing team,
  app icon, privacy manifest, export compliance key, deployment target, clean git tree,
  XcodeGen in sync, and the last release build and test results.
- Let agents run the same pipeline through MCP tools, and turn that off in settings.

## Entry points

| Entry                                                                            | What it does                                                                                                                                                                     | Way out / state                                                   |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Right panel launcher and "+" menu: "Apple build" (letter `X`)                    | Opens the panel for the active thread. Disabled with a reason when the server lacks the feature or there is no thread.                                                           | Close the tab. A running build keeps running; reopening shows it. |
| Command palette: "Apple: Open build panel"                                       | Same as the launcher.                                                                                                                                                            | Same.                                                             |
| Command palette: "Apple: Build", "Apple: Test", "Apple: Build and run"           | Starts a run with the panel's remembered selection for the project; opens the panel. Hidden when nothing is remembered yet.                                                      | "Apple: Cancel run" while one is running.                         |
| Keybinding commands `loom.apple-build-tooling.toggle`, `.build`, `.test`, `.run` | Unbound by default; the Keybindings settings page lists them as "Loom: Apple Build Tooling: ...".                                                                                | Same as the palette.                                              |
| Settings, Loom page, "Apple build" section                                       | Agent tool access, xcbeautify, test diagnostics, derived data location, "Runs kept per project" (default 20), "Show launched simulators in the Device panel". Clear run history. | Toggle back.                                                      |
| Agent tools                                                                      | `loom_apple_build_tooling_run`, `loom_apple_build_tooling_status`. Runs started by agents appear in the panel's history marked "Agent".                                          | Turning off agent access makes the tools return a clear error.    |
| Composer                                                                         | "Add to composer" on a run summary inserts a compact text summary.                                                                                                               | Remove the text from the draft.                                   |

## States

- **Loading**: skeleton rows while detection and `xcodebuild -list` run (they can take a few
  seconds; package resolution is shown as "Resolving packages...").
- **Empty**: "No Xcode project, workspace, XcodeGen spec or Swift package found in this
  workspace." with the searched depth.
- **Unsupported environment**: "Apple builds need a macOS environment with Xcode." On Linux
  with `xtool` on the PATH: "xtool found. Loom does not run xtool builds yet; use the terminal
  (`xtool dev`)."
- **Toolchain problems**: "Xcode command line tools point at CommandLineTools, not Xcode" (with
  the `xcode-select -s` command to copy), "Xcode needs first-launch setup" (with
  `xcodebuild -runFirstLaunch`), "No simulator runtime for iOS" (with
  `xcodebuild -downloadPlatform iOS`). Loom shows the commands; it never runs `sudo`.
- **Running**: status line with elapsed time, current phase ("Building", "Testing",
  "Installing", "Launching"), live log, Cancel.
- **Signing not set up** (device builds): the failure summary leads with the signing message
  above and the build's own signing error text below it.
- **Device unavailable**: "The device is locked or disconnected. Unlock it, keep it on the
  same network or cable, and try again." with devicectl's own error text.
- **Finished**: summary; failed runs open on the first error.
- **Interrupted**: a run that was active when the server stopped shows "Interrupted (server
  restarted)".
- **Disabled**: server lacks `apple-build-tooling` in `loomFeatures`: launcher disabled, palette
  entries hidden, settings section says "This environment's server does not have Apple build
  tooling."

## Surfaces and connection modes

Web and desktop show the same panel. Remote environments work over every connection mode
because every command runs on the environment host and only small JSON and log chunks cross
the wire. "Open in Xcode" is offered only in the desktop app when the environment is the local
machine; elsewhere the log can be downloaded. Mobile shows nothing. On an upstream T3 server
the feature is hidden or disabled as described above.

## Decisions

- Runs are child processes on the server, not terminal sessions. Reason: the panel needs
  structured results and a result bundle per run; the terminal drawer stays for interactive
  work.
- Derived data defaults to a Loom-owned folder per workspace
  (`<stateDir>/fork/apple-build-tooling/derived/<hash>`), so Loom builds never fight a running
  Xcode over the same DerivedData. A setting switches to Xcode's default.
- `-collect-test-diagnostics never` by default. Reason: `xcodebuild` otherwise collects a
  sysdiagnose after a failed test, which can add minutes.
- `-skipMacroValidation` and `-skipPackagePluginValidation` are never passed. Reason: they are
  security switches in `xcodebuild -help`.
- Agent tools are on by default. Reason: agents can already run `xcodebuild` in a shell, and
  the tools only make the result smaller and structured.
- Xcode's own MCP server (`xcrun mcpbridge`, Xcode 26.3+) is complementary, not replaced. The
  toolchain card shows whether it is available; connecting it to a provider stays a provider
  configuration step (see `docs/fork/user/apple-build-tooling.md`).
- Physical-device "Build and run" is in v1, minimal: paired devices from `xcrun devicectl`,
  build and install with the project's own signing, a clear error pointing to Xcode when
  signing is not set up. Loom never manages certificates or profiles and never passes
  `-allowProvisioningUpdates`. Tested by hand only. Reason (Kyle): running on his iPhone is a
  daily need, and the project's signing already works in Xcode.
- Run history is count-based: the last 20 runs per project, configurable in settings (5 to
  200). Reason (Kyle): predictable disk use without a time rule.
- Plain Swift packages are in v1: `swift build` and `swift test` share one compiler
  diagnostics parser, and `swift test --xunit-output` feeds a small xUnit XML reader that
  covers XCTest and Swift Testing. Reason (Kyle): packages are common in his projects, and the
  extra code is small.
