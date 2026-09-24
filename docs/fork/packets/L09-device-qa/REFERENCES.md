# L09 references

Sources for this packet. Treat external repositories as references, not code to copy.

## Old Loom

Selection P12 ("Build and install, evidence capture, scripted UI checks. Expand with the new
headless Xcode and simulator tooling. T3 already has the device panel itself") in
[selections.md](../../selections.md).

| File                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Keep / adapt / drop                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [apps/web/src/components/device/DeviceEvidencePanel.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/device/DeviceEvidencePanel.tsx) (342)                                                                                                                                                                                                                                                                                                      | Adapt: the evidence list per thread and device (screenshot, recording, diagnostics, scenario report), inline viewing. Drop its pagination by cursor (a capped subscription is enough) and the download route.                   |
| [apps/web/src/components/device/DeviceRecordingControls.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/device/DeviceRecordingControls.tsx) (165)                                                                                                                                                                                                                                                                                              | Adapt: start and stop with a 1 to 180 second bound.                                                                                                                                                                             |
| [apps/server/src/device/DeviceRecordingService.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/device/DeviceRecordingService.ts) (621), [packages/shared/src/deviceRecordingWorker.ts](https://github.com/bagelvault/loom/blob/a79ec506/packages/shared/src/deviceRecordingWorker.ts) (320)                                                                                                                                                             | Adapt the commands: `simctl io recordVideo --codec=h264`, Android `screenrecord --bit-rate 8000000 --time-limit N` plus `adb pull`, process ownership checks. Drop the phase machine's transfer step (files are already local). |
| [apps/server/src/device/DeviceEvidenceService.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/device/DeviceEvidenceService.ts) (552), [DeviceScreenshot.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/device/DeviceScreenshot.ts) (57)                                                                                                                                                                                           | Adapt: PNG signature check and 12 MiB cap. Drop the Asset Store coupling.                                                                                                                                                       |
| [apps/web/src/components/device/DeviceScenarioPanel.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/device/DeviceScenarioPanel.tsx) (537), [apps/server/src/device/DeviceScenarioDriver.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/device/DeviceScenarioDriver.ts) (262), [packages/contracts/src/deviceScenario.ts](https://github.com/bagelvault/loom/blob/a79ec506/packages/contracts/src/deviceScenario.ts) (41) | Drop in favor of argent flows. Worth remembering: its rules (exactly one selector match, refuse truncated trees, mark later steps skipped after a failure) are the same ones argent enforces.                                   |
| [apps/web/src/components/device/DeviceBuildPanel.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/device/DeviceBuildPanel.tsx) (336), [packages/shared/src/deviceDeployment.ts](https://github.com/bagelvault/loom/blob/a79ec506/packages/shared/src/deviceDeployment.ts) (241)                                                                                                                                                                 | Adapt only install and launch (`simctl install`, `adb install -r`, `aapt dump badging` for the package). Building belongs to L10.                                                                                               |
| [apps/server/src/device/DeviceDiagnosticsService.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/device/DeviceDiagnosticsService.ts) (360)                                                                                                                                                                                                                                                                                                              | Not in v1. If app log evidence is added later: `xcrun simctl spawn <udid> log show --last 1m --process <pid> --style ndjson --info --debug`, `adb logcat -d -v threadtime --pid=<pid> -t 500`, with secret redaction.           |

## Upstream T3 Code

| Path                                                                    | Why                                                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `docs/user/devices.md`                                                  | What the Device panel already does and its remote limits.                                         |
| `apps/web/src/components/device/DevicePanel.tsx:36,46-52,85-89,186-247` | The seam site: imports, props, `activeDevice`, toolbar.                                           |
| `apps/server/src/device/DeviceService.ts:109-154,731-752`               | `DeviceService` (list, open, sessionsForThread, screenshot).                                      |
| `packages/contracts/src/device.ts:19,26,50-62,106-136`                  | `DevicePlatform`, `LOCAL_DEVICE_HOST_ID`, `DeviceSummary`, `DeviceSession`, `DeviceServiceState`. |
| `apps/server/src/device/DeviceActions.ts:199-202,286-291,441-449`       | How upstream calls `simctl` and `adb` (launch, terminate).                                        |
| `apps/server/src/device/LocalDeviceHost.ts:322-357,377-387`             | Streaming child process pattern.                                                                  |
| `apps/server/src/mcp/toolkits/device/tools.ts:21-27`                    | Upstream's decision to leave install and input to `agent-device`.                                 |
| `apps/server/src/mcp/toolkits/device/handlers.ts:59,62,242`             | Quick start install text, SSH build note, `pngDimensions`.                                        |
| `apps/server/src/mcp/McpInvocationContext.ts:11,47-56`                  | `McpCapability`, `requireMcpCapability`.                                                          |
| `apps/server/src/provider/ProviderService.ts:869-914`                   | How the `device` capability follows Agent device access.                                          |
| `apps/server/src/mcp/McpHttpServer.ts:499-577`                          | `registerImageTool` (private; why fork tools return paths).                                       |
| `packages/contracts/src/assets.ts:19-25`                                | `media-file` asset resource.                                                                      |
| `apps/web/src/assets/assetUrls.ts:19-33`                                | `useAssetUrlState`.                                                                               |
| `apps/web/src/components/desktop/SnapShotCoordinator.tsx:139-184`       | Template for adding a captured image to the composer.                                             |
| `apps/web/src/composerDraftStore.ts:614-626`                            | `addImage`, `addImages`, `addFiles`.                                                              |
| `apps/web/src/lib/imageCompression.ts:450`                              | `compressImageToByteLimit`.                                                                       |
| `apps/web/src/components/ChatView.tsx:4141-4259`                        | `runProjectScript`: open a terminal and write a command.                                          |
| `apps/web/src/terminalUiStateStore.ts:567-577`                          | `setTerminalOpen`, `newTerminal`.                                                                 |
| `apps/server/src/serverActivation.ts:11-26`                             | `forkParked` for the cleanup reactor.                                                             |

## argent (software-mansion/argent)

https://github.com/software-mansion/argent, reviewed at `3c1f2ae` (2026-09-21), package
`@swmansion/argent` 0.25.2.

- License: mixed. Source is Apache-2.0 (`LICENSE.txt`); the per-platform
  `bin/<platform>/simulator-server`, `bin/darwin/ax-service` and the `native-devtools-ios`
  dylibs are proprietary to Software Mansion and may not be redistributed (README, "License").
  Loom never bundles or redistributes argent.
- Install: `npx @swmansion/argent@latest init` (wizard; installs globally, registers the MCP
  server in editors, copies skills; `--no-telemetry` turns telemetry off, `--local` installs it
  as a project dev dependency) or `npm install -g @swmansion/argent`
  (`packages/docs/docs/fundamentals/installation.mdx`).
- Telemetry is on by default; `argent telemetry disable` (global) or `--scope project` (writes
  `.argent/config.json`); `DO_NOT_TRACK=1` always turns it off (`Telemetry.md`,
  `packages/docs/docs/reference/telemetry.mdx`).
- Flows: `.argent/flows/<name>.yaml`, `steps` plus optional `executionPrerequisite`; e2e when
  the first non-`echo`/`script` step is `launch`; directives `launch`, `tap`, `long-press`,
  `swipe`, `type`, `scroll-to`, `pinch`, `rotate`, `await`, `assert`, `wait`, `snapshot`, `run`,
  `script`, `when`, `echo`, `tool`; baselines in `.argent/flows/__baselines__/<flow>/`
  (`packages/docs/docs/reference/flow-yaml.mdx`, `packages/docs/docs/features/flows.mdx`).
- CLI: `argent flow run <name|path|dir> [--device] [--platform ios|android|chromium|vega|ios-remote]
[--update-baselines] [--output <dir>] [-r] [--json | --json-stream]`, `argent flow list`;
  exit non-zero on failure; runs need the auto-started local tool-server; `--json-stream` is
  single-flow only (`packages/argent-cli/src/flow.ts`, help text and `writeJsonStreamRecord`).
- Report shapes: `StepReport` and `FlowReport` in `packages/argent-cli/src/flow.ts:23-68`.
- Recording tools for agents: `flow-start-recording`, `flow-add-step`, `flow-add-echo`,
  `flow-add-script`, `flow-finish-recording`, `flow-read-prerequisite`, `flow-execute`.
- Configuration: `ARGENT_PORT` (3001), `ARGENT_HOST` (127.0.0.1), `ARGENT_SIMULATOR_NO_WINDOW`,
  secrets via `ARGENT_SECRET_<NAME>` (`packages/docs/docs/reference/configuration.mdx`).
- Platforms: iOS simulators and physical iPhones (USB), Android emulators and devices, TVs,
  Chromium and Electron (`packages/docs/docs/fundamentals/supported-platforms.mdx`).

## Apple tooling

Verified locally with Xcode 27.0 (27A266a) on 2026-09-24 (`xcrun simctl help`,
`xcrun simctl io`): `io <device> screenshot [--type] [--display] [--mask] <file>`,
`io <device> recordVideo [--codec=h264|hevc] [--display] [--mask] [--force] <file>` ("simctl
writes 'Recording started' to stderr once the first video frame has been processed... Send
SIGINT to stop recording"), `status_bar`, `install`, `launch`, `list -j`, and `reboot`.
Xcode 27 release notes: `simctl` and `devicectl` gained `reboot`, and devicectl JSON version 5
adds `_deprecationNotice`
(https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes). Xcode's
own MCP tools (`xcrun mcpbridge`) do not include simulator capture or recording, so they do not
replace this packet (tool list: https://rudrank.com/exploring-xcode-using-mcp-tools-cursor-external-clients,
unofficial).

### Newer Apple tooling considered (Xcode 26.3 to 27)

| Tool                                                  | What it is                                                                                               | Use in this packet                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `xcrun mcpbridge` (Xcode 26.3+)                       | stdio bridge to Xcode's MCP tools (build, tests, previews, docs, file operations); needs a running Xcode | None. Build and test are L10's; it has no simulator capture tools.                        |
| `xcrun mcp-server enable` (Xcode 27 beta 5+ preview)  | Headless Xcode MCP server without an open workspace; `sudo` to enable                                    | None in v1; mentioned in L10's user doc.                                                  |
| Device Hub (Xcode 27)                                 | Xcode's GUI for simulators and devices, network pairing                                                  | None: GUI only; the upstream Device panel is Loom's equivalent.                           |
| `lldb-mcp` (Xcode 27)                                 | LLDB's MCP server                                                                                        | Out of scope.                                                                             |
| `xcrun simctl` (Xcode 27)                             | Headless simulator control, including new `reboot`                                                       | Screenshots, recordings, status bar, install, launch.                                     |
| `xcrun devicectl` (JSON v5)                           | Physical device control with stable JSON                                                                 | Not in v1 (flows and evidence are simulator and emulator only).                           |
| `xcodebuild test` + `xcresulttool export attachments` | XCUITest runs and their screenshots                                                                      | L10 territory; a later optional integration could import UI test attachments as evidence. |

## Other

- Android `screenrecord` 180 second limit and `--time-limit`: Android developer docs,
  https://developer.android.com/tools/adb#screenrecord (not re-verified for this packet).
