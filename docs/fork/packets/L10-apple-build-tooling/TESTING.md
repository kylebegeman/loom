# L10 testing

Focused tests only (AGENTS.md, "Verifying"). No repo-wide checks, no sleeps: tests that need a
run to finish wait on the run's completion `Deferred` or on the `watchRuns` stream reaching a
terminal status.

## Completion evidence

Record the actual Xcode, Swift and XcodeGen versions and supported command/output shapes.
Verify a real build success, compiler failure, XCTest and Swift Testing results, cancellation,
XcodeGen validation/generation, durable history and remote log access. Test simulator and
Mac destinations where applicable. The selected paired physical-device path retains the
manual check below; if no suitable device is available, report it as unverified rather than
silently removing it or claiming full verification.

Mark synthetic device fixtures as synthetic. Mocked processes and parser fixtures do not
prove installation, launch, signing behavior or process cancellation. Use isolated projects
and the current host's authorized device tooling for verification. Optional L09 integration
is checked only when both packets exist; L10 must work independently.

## Automated tests

Server (`apps/server/src/fork/apple-build-tooling/`):

| Test file                   | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `commands.test.ts`          | Destination specifiers (simulator platform from its runtime, device, Mac, generic, release platform from `SUPPORTED_PLATFORMS`); `xcodebuild` argv for every kind with container, scheme, destination, derived data (omitted when Xcode or the lane shim chooses it) and result bundle; one `-only-testing:` per identifier; XcodeGen specs build through their generated project; no argv contains provisioning, signing or validation-skipping flags; `swift test --parallel --xunit-output` with escaped `--filter`s; simctl and devicectl install and launch argv; display quoting.                                                                                              |
| `parsers.test.ts`           | Recorded `xcresulttool` fixtures: non-zero counts decode as non-zero (the old Loom regression), workspace-relative files with 1-based lines, target-qualified identifiers, unknown or missing fields degrade, defensive `sourceURL` parsing, issue caps. Recorded `simctl` fixtures (booted first) and devicectl in the current and deprecated forms (synthetic devices). Recorded package logs: compiler errors once each without excerpts or color codes, XCTest and Swift Testing failure lines, signing classification (synthetic messages). Recorded xUnit files: counts, statuses, skip reasons, entities, merged identifiers including a Swift Testing suite, missing halves. |
| `workspace.test.ts`         | Detection (embedded workspaces and generated projects not listed twice, XcodeGen project name, skipped folders, entry limit sets `truncated`); readiness checks and roll-up order; `-list -json`, test plan and workspace listings; the one application a scheme builds; the XcodeGen mirror comparison through a stub `xcodegen` (not generated, in sync, out of date with diff and changed schemes, invalid spec).                                                                                                                                                                                                                                                                 |
| `AppleRunStore.test.ts`     | On `SqlitePersistenceMemory`: round trip and newest-first listing, `markInterrupted`, pruning beyond the kept count while keeping running runs and dropping removed projects, settings defaults for missing fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `AppleBuildService.test.ts` | Real stub executables in a scratch workspace: swift build summarizes compiler errors; runs go through the lane's slot and folders; one run per workspace and cancel ends the whole process tree (checked by pid); `tailLog` order and resume from an offset; swift test summary from xUnit; a scheme built into Loom's DerivedData and launched on this Mac; log-based errors without a result bundle; request checks against workspace and platform; settings and clearing finished history.                                                                                                                                                                                        |
| `mcp.test.ts`               | Container, scheme and destination defaults; package `build`/`test` map to swift and the rest are refused; unique `loom_` tool names; an agent run returns its compact summary; both tools refuse when agent tools are off.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Contracts (`packages/contracts/src/fork/`):

| Test file                     | Covers                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apple-build-tooling.test.ts` | `formatRunSummaryForAgent` output shape and truncation; every method tag starts with `loom.apple-build-tooling.`. |

The extension point tests (`rpcAuthorization.test.ts`, `features.test.ts`, panel, settings,
palette and keybinding registry tests) must still pass with this packet's entries.

Web (`apps/web/src/fork/apple-build-tooling/`):

| Test file           | Covers                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `selection.test.ts` | Stored selections per environment and project, unreadable or throwing storage counts as nothing remembered; action to run kind per container; the missing-choice messages; a single test replaces the test plan; scheme preselection (remembered, then named after the project, then first); destination grouping and disabled devices; toolchain fix commands; issue grouping and dedupe. |

Client runtime: `packages/client-runtime/src/fork/apple-build-tooling.test.ts` covers the log
view's line cap across chunks.

No markup tests for the panel (AGENTS.md: do not render to static markup to assert props).

## Commands

```sh
vp test run apps/server/src/fork/apple-build-tooling packages/contracts/src/fork/apple-build-tooling.test.ts apps/web/src/fork/apple-build-tooling packages/client-runtime/src/fork/apple-build-tooling.test.ts
vp test run apps/server/src/fork/rpcAuthorization.test.ts apps/server/src/fork/features.test.ts apps/web/src/fork/panels/registry.test.ts apps/web/src/fork/settings/registry.test.ts apps/web/src/fork/commandPalette/registry.test.ts packages/contracts/src/fork/keybindings.test.ts
vp lint apps/server/src/fork/apple-build-tooling apps/web/src/fork/apple-build-tooling packages/contracts/src/fork packages/client-runtime/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
```

If this packet created `ext-settings`, regenerate the route tree before the web typecheck
(EXTENSION-POINTS.md section 7).

## Manual check

With Kyle's permission (AGENTS.md: ask before dev servers and browsers), on a Mac with Xcode:

1. Seed the worktree `.t3` with a `VACUUM INTO` copy (AGENTS.md, "Test data") and start
   `vp run dev` in the background; note the ports from the `[dev-runner]` line.
2. Create or pick a small SwiftUI app with an XcodeGen spec and a unit test target in a
   scratch directory, add it as a project, open a thread.
3. Panel: toolchain card shows the actual installed Xcode version, runtimes, XcodeGen and
   xcbeautify versions, with clear states for missing optional tools.
4. Build for a simulator: live log streams, summary shows success. Introduce a compile error:
   the summary lists it with file and line; "Add to composer" inserts the compact text.
5. Test with one failing test: the failure shows its identifier; "Test only this" runs just
   that test. Cancel a long test run: status `cancelled`, and `ps -p <pid>` for the recorded pid
   shows nothing.
6. Build and run on a simulator with "Show launched simulators in the Device panel" on and the
   device hub enabled: the app launches and the Device panel opens for that simulator.
7. Edit `project.yml` (add a source folder): the XcodeGen card shows "Out of date" and a diff;
   Generate brings it back to "In sync".
8. Readiness on the sample: missing privacy manifest and export compliance show as warnings.
9. From a thread, ask an agent to "build the app with the Loom Apple build tool": it calls
   `loom_apple_build_tooling_run`; the run appears in history marked "Agent". Turn off agent
   tools in settings: the next call returns the settings error.
   9b. Swift package: add a scratch package with one failing XCTest and one failing Swift
   Testing test as a project. Build lists a compile error with file and line when one is
   introduced; Test shows both failures with messages; "Test only this" runs just one.
   9c. Physical device (manual only, Kyle's iPhone paired in Xcode): the device appears under
   Devices; "Build and run" on a project with signing set up installs and launches the app;
   on a copy without a team the run fails with the signing message and Loom changed nothing
   in the project; an unpaired or Developer Mode off device is listed disabled with its fix.
   9d. Retention: change "Runs kept per project" to 5 and run six builds: only five remain.
10. Remote: open the same environment from another browser over Tailscale
    (`vp run dev --share`, pairing URL per AGENTS.md); the panel and log work; "Open in Xcode"
    is hidden.
11. Upstream server: point the Loom client at an upstream T3 server (or an environment without
    the fork server); the launcher entry is disabled with its hint and the palette entries are
    absent.

Physical device install is covered by manual step 9c only (PRODUCT.md, Decisions); no
automated test talks to a device.

## Results

Recorded 2026-10-08 on `feat/loom-apple-build-tooling`, Xcode 27.0 (27A266a), Swift 6.4,
xcresulttool 25115 (schema 0.4.0), XcodeGen 2.46.0, xcbeautify 3.2.1.

Automated, all passing: both test command lines above (15 files, 97 tests) plus the L19
suite (`apps/server/src/fork/project-lifecycle`, 37 tests), lint over the four fork
directories and `apps/web/src/fork/commandPalette`, and `tsc --noEmit` in server, web,
contracts and client runtime.

Real toolchain, through `AppleBuildService` with in-memory stores and no client, on a scratch
SwiftUI app (XcodeGen spec, XCTest and Swift Testing tests) and a scratch package:

- Detection lists the spec (with its generated project) and the package; the toolchain
  reports Xcode, runtimes, XcodeGen, xcbeautify, `mcpbridge` and the headless server state.
- `swift build` succeeds. `swift test` reports 6 tests, 3 failed (XCTest, top-level Swift
  Testing and a Swift Testing suite) with messages, workspace-relative files and lines.
  "Test only this" for each runs exactly that one test.
- Simulator build succeeds; a compile error is listed with `App/Sources/App.swift` and its
  line. Test reports 3 tests, 2 failed; "Test only this" works for both the XCTest
  (`SampleAppTests/DoubleTests/testDoubleFails()`) and Swift Testing identifier forms.
- Build and run installs and launches on a booted simulator, and asks the Device panel to
  open it; a failing Device panel does not fail the run.
- Cancelling a cold release build ends `cancelled` with no process left whose arguments name
  the run's directory. `tailLog` on a finished run replays the log and ends with `done`.
- XcodeGen: in sync, then out of date with a pbxproj diff after adding a source folder,
  `invalid` with XcodeGen's message for a broken spec, and in sync again after Generate.
- History lists every run newest first.

In a running web client (worktree dev server with a copy of real state, Browser panel), on
the same scratch app:

- The panel shows the toolchain, controls, destinations grouped by runtime plus this Mac,
  generic destinations and the paired phone, results with "started by an agent", history,
  the command line, the log (shown and downloaded), the running line and the live log.
- Simulator test failures show `Tests/Tests.swift` and their lines for both XCTest and Swift
  Testing. "Test only this" runs one test; "Add to composer" inserts the failure report.
- XcodeGen out of date with its diff, Generate, then in sync without a reload.
- Palette: "Apple: Open build panel", "Apple: Build" with the remembered selection, and
  "Apple: Cancel run" during a run. Cancel from the palette and from the panel both end
  `cancelled` with no `xcodebuild` or build script process left.
- From a real thread, the status tool lists destinations, the run tool rejects an unknown
  scheme with the schemes that exist, and a test run reports 1 passed and 2 failed.
- A build for the paired phone while it was unreachable shows the locked or disconnected
  message.

These checks found and fixed: swift test reporting a failed build when only tests failed,
Swift Testing failures without a workspace path, a Device panel defect failing a launched
run, compiler paths below `/private` staying absolute, xcodebuild test failures without a
file or line (taken from the log now), fork palette items not found by their own titles (any
fork source, not only this one), the XcodeGen card staying out of date after Generate, an
unreachable device getting raw xcodebuild text instead of the device message, and a build
xcodebuild never started reporting `succeeded` with an error.

Not yet verified:

- The `X` launcher shortcut and the Settings section in a client (the Browser panel host
  disconnected before these), remote access and an upstream server.
- Build and run on a physical device: the paired phone was unreachable (devicectl tunnel
  `unavailable`), so only the failure path ran. The Mac destination with a real app is
  covered by stubs only. Readiness on a real project (8) and retention in practice (9d,
  covered by `AppleRunStore.test.ts`) remain.
- Lane builds with a real L19 lane (covered by stubs in `AppleBuildService.test.ts`).
- The merged tree with the newest nightly was not typechecked; the depended-on APIs did not
  change.

## Merge safety

`git merge-tree` against `v0.0.46-nightly.20261008.2833` (`a6ec88f7a7`) and against
`origin/main` at `62f05fc04b` (2026-10-08): no conflicts. After Kyle merges, record the result
of `scripts/fork/loom.sh integrate nightly --dry-run` from a clean, synced `main`.
