# Apple builds

The **Apple build** panel builds, tests and runs Xcode projects and Swift packages in a
thread's workspace, and turns each run into a short summary: errors and warnings with file
and line, test counts, and each failing test. You and your agents read the summary instead of
scrolling through `xcodebuild` output.

## Getting started

Open **Apple build** from the right-panel launcher, or choose **Apple: Open build panel** in
the command palette. The panel looks for an `.xcworkspace`, `.xcodeproj`, XcodeGen spec
(`project.yml`) or `Package.swift` up to four folders deep in the thread's workspace. A
thread in a worktree builds that worktree.

Pick a project, a scheme and where to run it, then choose **Build**, **Test**, **Build and
run** or **Release build**. Loom remembers your choices for each project on this device, so
**Apple: Build**, **Apple: Test** and **Apple: Build and run** in the command palette repeat
them without opening the panel. Those commands, and one that shows or hides the panel, can be
given shortcuts in Keybindings.

One run goes at a time per workspace. Cancel stops the build and everything it started.

## Fixing the toolchain

The Toolchain section lists what is missing and the command that fixes it, for example
pointing `xcode-select` at Xcode, finishing Xcode's first launch, or downloading the iOS
simulator. Loom never runs these for you, because several need `sudo`; copy the command into
a terminal. XcodeGen and xcbeautify are optional; install them with Homebrew to generate
projects from a spec and to get readable logs.

Apple builds need a Mac. On a Linux environment the panel can still build and test Swift
packages.

## Runs and history

While a run goes, the panel shows its phase and the live log. When it ends you get the
summary. From there:

- **Add to composer** puts the summary into your message, ready to send to the agent.
- **Test only this** runs one failing test again.
- **Open in Xcode** opens the run's result bundle, and **Reveal log** shows the log file.
  Both appear only when the environment is the Mac you are using. **Download log** works
  everywhere.

Each project keeps its last 20 runs, logs included. Change the number in **Settings, Loom,
Apple build, Runs kept per project**, or clear the history there.

Builds use their own DerivedData folder by default, so they do not disturb a project open in
Xcode. When the thread has a storage lane, builds go there instead and wait for a free build
slot (see [Storage and lanes](./project-lifecycle.md)).

## Swift packages

A folder with `Package.swift` builds and tests with `swift build` and `swift test`. Both XCTest
and Swift Testing failures show with their messages, and **Test only this** works for both.
Packages do not have schemes or destinations.

## XcodeGen

When a project comes from an XcodeGen spec, the panel shows whether the `.xcodeproj` on disk
matches the spec, with the difference when it does not. **Generate** rewrites the project
from the spec. It is the only action that changes files in your workspace.

## Running on an iPhone or iPad

Connected and network devices appear under Devices. Before a device can run your app:

1. Pair it once in Xcode, under **Window, Devices and Simulators**.
2. Turn on Developer Mode on the device, under **Settings, Privacy & Security**.
3. Set up signing for the app target in Xcode (a team, and automatic or manual signing).

Loom never creates certificates, provisioning profiles or registrations, and never changes
your signing settings. If a run fails on signing, the summary says so; fix it in Xcode and run
again. A locked or disconnected device shows its own message.

## Agent tools

Agents can use `loom_apple_build_tooling_run` and `loom_apple_build_tooling_status` to build,
test and run through the same pipeline. Their runs appear in the history marked **Agent**, and
they get the same compact summary you see. To stop agents from starting runs, turn off
**Settings, Loom, Apple build, Agent tools**.

## Xcode's own MCP server

Xcode includes an MCP server of its own that lets agents read build issues, previews and
documentation from a running Xcode. Loom does not set it up. To add it to an agent:

```sh
codex mcp add xcode -- xcrun mcpbridge
claude mcp add --transport stdio xcode -- xcrun mcpbridge
```

It needs Xcode running unless you turn on the headless preview in Xcode 27 with
`sudo xcrun mcp-server enable`. The Toolchain section shows whether each is available.
