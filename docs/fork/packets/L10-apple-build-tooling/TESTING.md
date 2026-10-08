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

## Merge safety

Record here the merge preview result against the newest nightly (SEAMS.md, "Merge check") and,
after Kyle merges, the result of `scripts/fork/loom.sh integrate nightly --dry-run` from a
clean, synced `main`.
