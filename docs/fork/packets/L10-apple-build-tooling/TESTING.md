# L10 testing

Focused tests only (AGENTS.md, "Verifying"). No repo-wide checks, no sleeps: tests that need a
run to finish wait on the run's completion `Deferred` or on the `watchRuns` stream reaching a
terminal status.

## Automated tests

Server (`apps/server/src/fork/apple-build-tooling/`):

| Test file                   | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commands.test.ts`          | Argv for every run kind and container kind; destination specifiers (simulator with iOS, watchOS and visionOS runtimes, device, mac, generic); `-collect-test-diagnostics` from settings; `-only-testing:` repetition; derived data flag omitted for `xcode-default`; the two validation-skipping flags never appear; no argv for any kind or destination contains `-allowProvisioningUpdates`, `-allowProvisioningDeviceRegistration`, `-authenticationKey`, `CODE_SIGN_`, `DEVELOPMENT_TEAM=` or `PROVISIONING_PROFILE`; devicectl install and launch argv; `swift test --parallel --xunit-output <runDir>/xunit.xml` with one `--filter` per escaped identifier (parentheses escaped).                                                                 |
| `xcresult.test.ts`          | Decoding the recorded `build-results` and `test-results summary` fixtures: non-zero counts decode as non-zero (the old Loom regression); issues map to `AppleIssue` with workspace-relative file and line; `sourceURL` without a line keeps the message; an unknown extra field is ignored; a missing optional block yields `unknown` result, not a failure; caps at 100 issues and failures.                                                                                                                                                                                                                                                                                                                                                            |
| `simulators.test.ts`        | `simctl list devices available -j` and `runtimes -j` fixtures (booted first, grouped by runtime); hand-written `devicectl --json-output` fixture with `_deprecationNotice` and the Xcode 27 `properties` dictionary: simulated entries dropped, paired and unpaired devices, `developerModeStatus` as a string and as a keyed object, fallback to the deprecated dictionaries when `properties` is missing; empty device list on non-zero exit.                                                                                                                                                                                                                                                                                                          |
| `diagnostics.test.ts`       | From the recorded package logs: compiler errors and warnings with workspace-relative file, line and message, excerpt lines and duplicates ignored, ANSI codes stripped; XCTest and Swift Testing failure lines keyed and parsed; `classifySigningIssue` matches synthetic signing messages (marked synthetic) and ignores an ordinary compile error.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `xunit.test.ts`             | The recorded `xunit.xml` and `xunit-swift-testing.xml`: counts, statuses, skipped reason, entity decoding; merge gives totals across both files, XCTest identifiers `<Module>.<Class>/<test>`, Swift Testing identifiers `<Module>.<func>()`, the XCTest "failure" message replaced by the log line's message with file and line; a missing file leaves that half empty; malformed XML yields no cases, not an exception.                                                                                                                                                                                                                                                                                                                                |
| `readiness.test.ts`         | Each check's pass, warning and fail cases from synthetic build settings; the overall roll-up order (fail, warning, unknown, pass).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `detect.test.ts`            | Container classification: workspace inside a project (`App.xcodeproj/project.xcworkspace`) is not listed separately; XcodeGen spec links its generated project; skipped directories; entry limit sets `truncated`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `xcodegen.test.ts`          | Report state from fixture files: in sync, out of date (diff produced and capped), not generated, invalid spec (stderr surfaced). The `xcodegen` process is faked through a test `ProcessRunner` layer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `AppleRunStore.test.ts`     | On `SqlitePersistenceMemory`: insert and list order, retention deletes the oldest beyond `keepRunsPerProject` (default 20, and a changed value applies on the next run), `markInterrupted` on start, orphan removal for missing projects, settings defaults and updates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `AppleBuildService.test.ts` | With a fake spawner that emits scripted output and exit codes: a second `start` on the same cwd fails with `busy`; different cwds run concurrently; `cancel` ends as `cancelled` and closes the child scope; `tailLog` from offset 0 replays the ring then follows live chunks and completes when the run ends; `watchRuns` emits on start, phase change and finish only; a failing build still extracts a summary when the bundle exists; `run` refuses a scheme with two application products; a failing device build with a signing issue gets `hint: "signing"` and the fix text; a failing devicectl install gets `hint: "device-unavailable"`; `swiftTest` creates the run directory before spawning and builds its summary from both xUnit files. |
| `mcp.test.ts`               | Tool names start with `loom_` and are unique; disabled agent tools return the typed error; the run tool's `summaryText` is at most 8 KB and `logTail` at most 60 lines; timeouts return `status: "running"` with the run id. Run through `withForkRuntime` with a test `ForkRuntime` context (EXTENSION-POINTS.md, MCP tests).                                                                                                                                                                                                                                                                                                                                                                                                                           |

Contracts (`packages/contracts/src/fork/`):

| Test file                     | Covers                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apple-build-tooling.test.ts` | `formatRunSummaryForAgent` output shape and truncation; every method tag starts with `loom.apple-build-tooling.`. |

The extension point tests (`rpcAuthorization.test.ts`, `features.test.ts`, panel, settings,
palette and keybinding registry tests) must still pass with this packet's entries.

Web (`apps/web/src/fork/apple-build-tooling/`):

| Test file           | Covers                                                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selection.test.ts` | The selection store: per environment and project keys, a stored scheme that no longer exists falls back to the first scheme, storage failures (throwing `localStorage`) fall back to defaults. |

No markup tests for the panel (AGENTS.md: do not render to static markup to assert props).

## Commands

```sh
vp test run apps/server/src/fork/apple-build-tooling packages/contracts/src/fork/apple-build-tooling.test.ts apps/web/src/fork/apple-build-tooling
vp test run apps/server/src/fork/rpcAuthorization.test.ts apps/server/src/fork/features.test.ts apps/web/src/fork/panels/registry.test.ts apps/web/src/fork/settings/registry.test.ts packages/contracts/src/fork/keybindings.test.ts
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
3. Panel: toolchain card shows Xcode 27.0, runtimes, xcodegen and xcbeautify versions.
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
   Change "Runs kept per project" to 5 and run six builds: only five remain.
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
