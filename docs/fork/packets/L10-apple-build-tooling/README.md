# L10: Apple build tooling

Status: Ready to build. <!-- Not started | Designing | Ready to build | In progress | Done | Blocked: reason -->

An "Apple build" right panel for projects that contain an Xcode project, an Xcode
workspace, an XcodeGen spec or a Swift package. The user picks a scheme and a destination
and builds, tests, or builds and runs the app on a simulator or a connected device. Every run
is recorded with its log and an XCResult summary (errors and warnings with file and line,
test counts and failures), so neither the user nor an agent has to scroll through
`xcodebuild` output. The panel also checks whether an XcodeGen spec and the committed
`.xcodeproj` are in sync, regenerates the project on request, and runs a release readiness
checklist. Agents get two MCP tools that run the same pipeline and return the compact
summary.

## Scope

- In:
  - Detection of Apple containers in the thread's workspace: `*.xcworkspace`,
    `*.xcodeproj`, `project.yml` / `project.yaml` (XcodeGen), `Package.swift`.
  - Toolchain card: Xcode version and path, first-launch status, installed simulator
    runtimes, and presence of `xcodegen`, `xcbeautify`, `xcrun mcpbridge` and the Xcode 27
    headless `xcrun mcp-server`.
  - Scheme, configuration and test plan discovery (`xcodebuild -list -json`,
    `-showTestPlans`).
  - Destinations: available simulators (`xcrun simctl list devices available -j`), connected
    devices (`xcrun devicectl list devices --json-output -`), "My Mac", and generic build
    destinations.
  - Runs: build, test, build and run (install and launch on a simulator, a paired physical
    device with the project's own signing, or this Mac), release build, XcodeGen generate, and
    `swift build` / `swift test` for packages (compiler diagnostics parser plus an xUnit XML
    reader for XCTest and Swift Testing). One run at a time per workspace, cancellable, with a
    live log and a durable history (last 20 per project by default, configurable 5 to 200).
  - XCResult summaries through `xcrun xcresulttool get build-results` and
    `get test-results summary` (the non-deprecated commands).
  - XcodeGen validate (`xcodegen dump --type json`) and diff (generate into a temporary
    directory and compare `project.pbxproj`), plus generate into the workspace.
  - Release readiness checklist from the Release build settings, the asset catalog, the
    privacy manifest, git state and the latest runs.
  - Optional integration with upstream's Device panel: a simulator the app was launched on is
    opened in the Device panel when the device hub is enabled.
  - Agent tools: `loom_apple_build_tooling_run` and `loom_apple_build_tooling_status`.
  - An "Apple build" section on the Loom settings page, palette entries, unbound keybinding
    commands.
- Out:
  - Archiving, exporting, notarization, TestFlight and App Store Connect uploads, Fastlane
    lanes (a later packet; old Loom's ASC client is kept as a reference only).
  - Editing XcodeGen specs from the UI (add target, add package). Agents edit YAML; the panel
    validates, diffs and generates.
  - Code signing management. Builds for devices use the project's own signing settings;
    Loom never passes `-allowProvisioningUpdates` and never touches certificates or
    profiles. Physical-device runs are tested by hand only.
  - Builds on SSH device hosts. Runs happen on the environment host.
  - Android builds (Gradle). L09 covers installing an existing `.apk`.
  - xtool on Linux beyond detection and a documented manual path (see TECHNICAL.md,
    "Linux environments and xtool").
  - Mobile UI.

## Surfaces

- Web and desktop: supported. Everything runs on the environment server and streams over the
  WebSocket RPC, so it works locally, over Tailscale and through T3 Connect.
- Mobile: not supported. The upstream App Store app never shows fork UI; fork RPCs remain
  usable if a later mobile packet wants them.
- Upstream T3 server: the launcher entry is disabled with "Needs a Loom server with Apple
  build tooling".
- Non-macOS environment: the panel explains that Apple builds need macOS with Xcode, and shows
  the xtool note on Linux.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (fork RPC group, `ForkLayer`, persistence, `loomFeatures`). May create it.
- [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels) (the "Apple build" panel). May create it.
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings) (the "Apple build" section). May create it.
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (palette entries). May create it.
- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) and [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (unbound `loom.apple-build-tooling.*` commands). May
  create them.
- [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp) (two agent tools). May create it.

## Packet seams

None. Everything goes through extension points. See [SEAMS.md](./SEAMS.md).

## Optional integrations

- L09 (device-qa): L09's Install section lists this packet's latest successful build
  products for the project as install candidates, and "Build and run" gets a "Run flows after
  launch" checkbox that calls L09's flow runner for the launched simulator. The checkbox is
  offered only when the destination is a simulator (flows run only on simulators and
  emulators; it is hidden for physical devices and "My Mac"). Whichever packet lands second
  adds both hooks. Neither packet imports the other's modules unless both exist in the tree.

## Size estimate

Large: about 4,000 to 4,800 lines including tests. Server service and parsers are the bulk
(about 2,100, including the diagnostics parser and xUnit reader), the panel about 1,250.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
this folder in order: PRODUCT.md, TECHNICAL.md, SEAMS.md, IMPLEMENTATION.md, TESTING.md,
REFERENCES.md. Work in a worktree. You need a Mac with Xcode for the manual checks; the
automated tests use recorded JSON fixtures and run anywhere.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources, including the verified Xcode 27
  command-line facts.
