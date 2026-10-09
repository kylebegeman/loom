# Device QA

The **Device QA** panel adds repeatable checks on top of the Device panel. It runs your
project's recorded UI flows on a simulator or emulator and shows each step as it happens.
It also keeps a list of screenshots, screen recordings and app installs for each thread,
so you can hand any of them to the agent in one click.

## Getting started

Open **Device QA** from the right-panel launcher, from the **Device QA** button above a
device in the Device panel, or with **Device QA: Open** in the command palette. Pick a
device at the top of the panel. The list shows booted simulators and emulators on the
environment host first, then devices open in the Device panel. If nothing is running, start
a simulator from the panel.

The panel has three tabs: **Flows**, **Evidence** and **Install**. It needs a Loom server;
connected to a T3 Code server, the launcher entry is disabled.

## Setting up argent

Flows run with [argent](https://github.com/software-mansion/argent) from Software Mansion,
which you install yourself. Until it is installed, the Flows tab shows the install command.
**Type in terminal** opens a new terminal with the command typed but not run, so you can
review it and press Enter. The full installer also registers argent's tools with your
editors and agents, which **Record with the agent** needs. A runner-only command is listed
too.

argent's source is Apache-2.0, and its per-platform binaries are proprietary. Loom starts
argent with telemetry off, but a flow run can share the argent helper an agent already
started, which follows argent's own setting. While that setting has telemetry on, the panel
says so, and **Turn off telemetry** switches it off for flow runs, agents and the terminal.

Screenshots, recordings and installs work without argent.

## Flows

The Flows tab lists the YAML flows in the project's `.argent/flows` folder, grouped by
folder. Open one to read its steps. **Run** runs one flow; **Run folder** runs every
end-to-end flow in that folder and its subfolders, one after another. Fragments (flows meant to be included by
others) are listed but not run on their own.

Steps appear live with their duration. When a snapshot step fails, the panel shows the
saved baseline, what the device shows now and the difference. From a finished run:

- **Run failed again** reruns only the flows that failed.
- **Update baselines** replaces the saved baseline images with the current screen after you
  confirm. Commit the new images to keep them.
- **Cancel** stops a run in progress.

History lists recent runs for the project, including runs an agent started. Pick one to see
its steps again. **Device QA: Run last flow** in the command palette repeats the latest run.

Flows run on simulators and emulators on the environment host. A physical device, or a
device on an SSH host, can still capture screenshots.

On iOS, argent's flow steps find elements in the app's UIKit views. Text and identifiers
inside a SwiftUI screen are not visible to them, so give those screens UIKit-backed
controls or use coordinate steps.

### Recording a new flow

**Record with the agent** asks for a flow name, an optional folder and what the flow should
do, then writes a prompt in the composer asking the agent to record it with argent's flow
tools. Send it, then refresh the Flows tab to see the new flow.

## Evidence

**Screenshot** saves the device's screen to the thread's evidence list. On an iOS simulator,
**Clean status bar** shows 9:41 with a full battery and signal in the image and restores the
real status bar afterwards. **Record screen** starts a recording; stop it from the panel,
the Device panel, or **Device QA: Stop recording** in the palette. Recordings stop on their
own after three minutes.

Each item has:

- **Attach**, which adds a screenshot to your message as an image. Recordings, installs and
  flow reports go into the message as their path on the environment host, which the agent
  can open.
- **Copy path**, and **Delete**.

Flow reports open their run in the Flows tab. The header shows how many items the thread has
and the space they use. **Delete all for this thread** removes them after you confirm. A
deleted flow report's run stays in History. Deleting a thread deletes its evidence.

**Capture evidence** above a device in the Device panel takes a screenshot without opening
Device QA. The Device panel's own screenshot download still works as before.

## Installing a build

The Install tab installs an iOS simulator `.app` or an Android `.apk` from the environment
host on the chosen device, and launches it unless you clear **Launch after installing**.
Paths can be absolute or relative to the thread's workspace.

## Agents

Agents can run flows and capture screenshots and recordings with two Loom tools. They use
the same **Agent device access** setting as the Device panel: turn it off and the tools
refuse. Items an agent captured or ran are marked **Agent**.

## Settings and shortcuts

**Settings, Loom, Device QA** sets the argent path, how many runs each project keeps,
whether old evidence is deleted after a number of days, and whether clean status bar is on
by default.

**Keybindings** can give shortcuts to showing or hiding the panel, capturing a screenshot
and running the last flow. None are set by default.
