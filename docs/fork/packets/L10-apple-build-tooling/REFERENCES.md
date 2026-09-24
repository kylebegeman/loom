# L10 references

Sources for this packet. Treat external repositories as references, not code to copy.

## Old Loom

Selection F21 ("XcodeGen, XCResult summaries, release readiness; pairs with P12") in
[selections.md](../../selections.md). Old Loom's Apple area was about 9,300 non-test lines, but
mostly detection, planning and approval scaffolding: its shell's status card was hard-coded
("Commands: Planned", "Mode: Read only").

| File                                                                                                                                                                                                                                                                                                                                                                                                                                    | Keep / adapt / drop                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [apps/web/src/components/apple/AppleAreaShell.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/apple/AppleAreaShell.tsx) (302)                                                                                                                                                                                                                                                                             | Drop. A 10-surface area shell with placeholder status.                                                                                                                                                                                                                                                                                                                                                                                            |
| [apps/web/src/components/apple/AppleSurfaces.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/apple/AppleSurfaces.tsx) (2,083)                                                                                                                                                                                                                                                                             | Drop. Read-only lists; the XCResult surface never showed a result.                                                                                                                                                                                                                                                                                                                                                                                |
| [apps/server/src/apple/Layers/AppleDeveloperWorkflows.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/apple/Layers/AppleDeveloperWorkflows.ts) (2,507)                                                                                                                                                                                                                                                             | Adapt small parts: the discovery walk (depth limit, skipped directories), the command table (`swift build/test`, `xcodebuild build/test/archive`, `xcodegen generate`, `simctl list`), warnings as `{code, message, severity}`, and the readiness roll-up. Do not copy its XCResult mapper: it reads `record.tests.failedCount`, which xcresulttool never emits, so counts were always zero. Its readiness checks never read real build settings. |
| [apps/server/src/apple/Layers/AppleXcodeGenCockpit.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/apple/Layers/AppleXcodeGenCockpit.ts) (994)                                                                                                                                                                                                                                                                     | Adapt the idea (validate, diff, generate), drop the hand-rolled YAML reader and the approval-only "generate". Use `xcodegen dump` and a temporary generate instead.                                                                                                                                                                                                                                                                               |
| [packages/contracts/src/apple.ts](https://github.com/bagelvault/loom/blob/a79ec506/packages/contracts/src/apple.ts) (458)                                                                                                                                                                                                                                                                                                               | Adapt a trimmed subset of the shapes (tool summary, command report statuses).                                                                                                                                                                                                                                                                                                                                                                     |
| [apps/server/src/apple/Layers/AppleAscTransport.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/apple/Layers/AppleAscTransport.ts) (603), [AppleAccount.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/apple/Layers/AppleAccount.ts) (835)                                                                                                                                                   | Drop for this packet; reference for a later App Store Connect packet (real JSON:API client and ES256 JWT signing).                                                                                                                                                                                                                                                                                                                                |
| [apps/server/src/device/DeviceBuildService.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/device/DeviceBuildService.ts) (834), [packages/shared/src/deviceBuildPlan.ts](https://github.com/bagelvault/loom/blob/a79ec506/packages/shared/src/deviceBuildPlan.ts) (147), [packages/shared/src/deviceDeployment.ts](https://github.com/bagelvault/loom/blob/a79ec506/packages/shared/src/deviceDeployment.ts) (241) | Adapt: the `xcodebuild ... -destination "platform=iOS Simulator,id=<UDID>" -derivedDataPath ... -resultBundlePath ...` plan, the second `-showBuildSettings -json` pass, and the rule that exactly one `com.apple.product-type.application` product may be installed. Drop the Runner relay, decision approvals and digest-verified retention (useful, but not needed for v1).                                                                    |

## Upstream T3 Code

| Path                                                                        | Why                                                                                                              |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/server.ts:482-494`                                         | `RuntimeCoreDependenciesLive`; `DeviceLayerLive` merged at 494 makes `DeviceService` reachable from `ForkLayer`. |
| `apps/server/src/processRunner.ts:20-36,140-145`                            | Buffered command runner and its options.                                                                         |
| `apps/server/src/device/LocalDeviceHost.ts:322-357,377-387,395`             | Streaming `ChildProcessSpawner` usage, output decoding, exit code.                                               |
| `apps/server/src/device/DeviceService.ts:109-154`                           | `DeviceService` interface (`open`, `list`).                                                                      |
| `packages/contracts/src/device.ts:149-157`                                  | `DeviceOpenInput`.                                                                                               |
| `apps/web/src/components/ChatView.tsx:4536-4592`                            | Client auto-open of the Device panel when a session appears.                                                     |
| `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:174,217` | `getProjectShellById`, `getThreadShellById`.                                                                     |
| `apps/server/src/checkpointing/Utils.ts:12`                                 | `resolveThreadWorkspaceCwd`.                                                                                     |
| `apps/server/src/project/ProjectSetupScriptRunner.ts:180-191,205-280`       | The terminal-based alternative that was rejected (sentinel exit codes).                                          |
| `apps/server/src/provider/CodexDeveloperInstructions.ts:15-19`              | Upstream's "do not call simctl, adb, xcrun" guidance for device tools.                                           |
| `apps/server/src/mcp/McpInvocationContext.ts`                               | `threadId` for MCP handlers.                                                                                     |
| `apps/web/src/components/chat/ChatComposer.tsx:1216-1256`                   | `ChatComposerHandle.insertTextAtEnd`.                                                                            |
| `packages/contracts/src/editor.ts:75`                                       | `file-manager` editor for "Reveal log".                                                                          |
| `packages/client-runtime/src/state/runtime.ts:612,646,678`                  | Atom factories.                                                                                                  |

## Verified command-line facts

Checked on Kyle's Mac on 2026-09-24 with Xcode 27.0 (27A266a) selected
(`/Applications/Xcode.app/Contents/Developer`), by running `--help` / `--schema`:

- `xcodebuild -help` lists `-json` ("implies -quiet"), `-resultBundlePath`, `-derivedDataPath`,
  `-testPlan`, `-showTestPlans`, `-only-testing:`, `-skip-testing:`, `-test-iterations`,
  `-retry-tests-on-failure`, `-run-tests-until-failure`, `-collect-test-diagnostics
on-failure|never`, `-parallel-testing-enabled`, `-parallel-testing-worker-count`,
  `-enumerate-tests` with `-test-enumeration-format json`, `-showdestinations`,
  `-checkFirstLaunchStatus`, `-runFirstLaunch`, `-downloadPlatform`, `-downloadAllPlatforms`,
  `-importPlatform`, `-list -json`, `-showBuildSettings -json`, and the security switches
  `-skipPackagePluginValidation` and `-skipMacroValidation`.
- `xcrun xcresulttool` version 25115: `get test-results summary|tests|test-details|activities|insights|metrics`,
  `get build-results`, `get log`, `get content-availability`, `export
diagnostics|coverage|attachments|evaluations|metrics`, `merge`, `compare`. `get object`,
  `export object`, `graph` and `formatDescription` are marked deprecated. Default schema
  version 0.4.0; `--compact` and `--schema` exist on each `get` command.
- `xcrun simctl`: `boot`, `bootstatus`, `install`, `launch`, `terminate`, `list -j`,
  `io <device> screenshot|recordVideo`, `status_bar`, `privacy`, `push`, `ui`, `runtime`,
  `reboot` (new in Xcode 27).
- `xcrun devicectl`: `--json-output <path>` accepts `-` for stdout (human output then goes to
  stderr); JSON output "is versioned and will remain stable across releases"; `device install`,
  `device process`, `device capture`, `list devices`.
- `xcrun mcpbridge`: stdio bridge to Xcode's MCP tool service; `MCP_XCODE_PID` and
  `MCP_XCODE_SESSION_ID` environment variables; `mcpbridge run-agent claude|...`.
- `xcrun mcp-server`: `open`, `stop`, `enable` / `disable` (headless mode, `sudo`), `approve`,
  `allow-folder`, `status`, `show-logs`. On Kyle's Mac `status` printed "Permission: enabled"
  and "mcp-server: not running".
- `xcrun agent skills export [--replace-existing <dir>]` exports Xcode's bundled agent skills.
- XcodeGen 2.46.0: `generate --spec --project --project-root --use-cache --cache-path --quiet
--only-plists`, `dump --type swift-dump|json|yaml|parsed-json|parsed-yaml|summary --file`.
- xcbeautify 3.2.1: `--quiet`, `--quieter`, `--preserve-unbeautified`, `--is-ci`,
  `--disable-colored-output`, `--disable-logging`, `--renderer`, `--report junit`.
- Swift 6.4: `swift test --parallel --xunit-output <path> --filter <regex>`. Checked on a scratch
  package on 2026-09-24: the XCTest file is written only with `--parallel` and its failure
  message is the word "failure"; Swift Testing results go to `<name>-swift-testing.xml` next to
  it, with the expectation text and `<skipped>` reasons; nothing is written when the output
  directory is missing; `swift test list` prints `<Module>.<Class>/<test>` and
  `<Module>.<func>()`; `--filter` with an escaped identifier runs one test; compiler
  diagnostics are `<path>:<line>:<col>: error: <message>`, XCTest failures
  `<path>:<line>: error: -[<Module>.<Class> <test>] : <message>`, Swift Testing issues
  `Test <func>() recorded an issue at <File>.swift:<line>:<col>: <message>`.
- `xcodebuild -help`: `-allowProvisioningUpdates` "Allow xcodebuild to communicate with the
  Apple Developer website", creating and updating profiles, app IDs and certificates for
  automatically signed targets; `-allowProvisioningDeviceRegistration` registers the device.
  Loom passes neither.
- `xcrun devicectl device install app --help` and `device process launch --help`:
  `--device <uuid|ecid|serial_number|udid|name|dns_name>`, `--json-output <path>`,
  `--terminate-existing`. `devicectl list devices --json-output -` (JSON version 5) lists
  simulators as well as physical devices; each entry has a `properties` dictionary
  (`hardware.reality`, `hardware.platform`, `connection.pairingState`, `connection.state`,
  `state.name`, `state.developerModeStatus`, `software.osVersionNumber`) and deprecated
  `hardwareProperties`, `deviceProperties`, `connectionProperties` named in
  `_deprecationNotice`.

## External

- Xcode 27 release notes (tooling items used here: headless `xcrun mcp-server` preview, new MCP
  tools, devicectl JSON version 5 and `_deprecationNotice`, `simctl reboot`, LLDB MCP):
  https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes (read
  through the documentation JSON endpoint, since the page renders client-side).
- Apple Newsroom, "Xcode 26.3 unlocks the power of agentic coding" (Claude Agent and Codex in
  Xcode, capabilities exposed over MCP):
  https://www.apple.com/newsroom/2026/02/xcode-26-point-3-unlocks-the-power-of-agentic-coding/
- WWDC26 "What's new in Xcode 27" (Device Hub, agents in the editor):
  https://developer.apple.com/videos/play/wwdc2026/258/
- Xcode MCP tool list and setup through `xcrun mcpbridge` (community write-ups; the 20 tool
  names such as `BuildProject`, `GetBuildLog`, `RunSomeTests`, `RenderPreview`,
  `DocumentationSearch`, `XcodeListWindows`):
  https://rudrank.com/exploring-xcode-using-mcp-tools-cursor-external-clients and
  https://codex.danielvaughan.com/2026/06/11/xcode-27-codex-cli-mcp-bridge-apple-agentic-coding-ios-macos-development/
  (unofficial; tool names not checked against Apple docs).
- Report that `xcodebuild` collects diagnostics after failed tests unless
  `-collect-test-diagnostics never` is passed (third-party PR, flag verified locally, the
  default behavior not verified): https://github.com/AndrewKochulab/sim-mirror/pull/29
- XcodeGen (MIT), release 2.46.0 of 2026-07-16: https://github.com/yonaskolb/XcodeGen,
  https://github.com/yonaskolb/XcodeGen/releases/tag/2.46.0
- xcbeautify (MIT): https://github.com/cpisciotta/xcbeautify
- XcodeBuildMCP (MIT), MCP server and CLI for agent Xcode work, considered as an engine and not
  used: https://github.com/getsentry/XcodeBuildMCP
- xtool (MIT), cross-platform Xcode replacement for SwiftPM iOS apps on Linux, WSL and macOS:
  https://github.com/xtool-org/xtool (reviewed at `f9706d9`; `Package.swift:54` depends on
  `xtool-org/xadi` 0.4.1). xadi is LGPL-2.1 ("CoreADI wrapper based on libprovision"):
  https://github.com/xtool-org/xadi. Call the CLI only; never vendor or link.
- Fastlane: out of scope; a later packet.
