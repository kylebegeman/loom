# Storage and lanes

Long agent tasks fill a disk quickly with build output, Xcode DerivedData and temporary
files. Loom gives each checkout an agent works in a **lane**: a capped space for that
scratch data, kept outside the checkout and removed when the work is done.

## How lanes work

A lane is created the first time an agent starts a run in a checkout. The project's main
checkout and each worktree get their own lane, under the lanes folder
(`~/Developer/lanes` by default):

```
~/Developer/lanes/
  my-app/
    main/            lane for the project's main checkout
      LANE.md
      space/tmp      temporary files
      space/build    build output, DerivedData, packages
      space/data     anything the agent wants to keep for this checkout
    my-app-search/   lane for a worktree
```

On macOS 26 and later each lane is a disk image capped at its size, so a runaway build
stops at the cap instead of filling the disk. Elsewhere a lane is a plain folder with a
soft cap. Lanes default to 40 GB, and 100 GB for Xcode projects.

When every thread using a checkout is settled or archived, its lane is deleted. The
checkout itself is never touched.

## Keeping work going unattended

Agents can see their lane and clean it themselves with the `loom_project_lifecycle_status`,
`loom_project_lifecycle_free` and `loom_project_lifecycle_grow` tools. Loom also watches
each lane:

- At 75% full, a running agent is asked once to free space.
- At 90% full while no agent is running, Loom clears the lane's `tmp` folder and grows the
  lane if that was not enough.
- When the disk's free space drops below the reserve (40 GB by default), running agents are
  asked to free space, lanes stop growing, and Loom shows a low space notice.

Files in `data` are never cleared automatically.

## What a lane owns

Besides its space, a lane owns things its agents start, and releases them when the lane is
deleted:

- Servers and watchers started with `lane-run` (for example `lane-run --name web npm run
dev`), and anything listening on the lane's ports. Each lane has 20 ports; the first is in
  `LOOM_LANE_PORT`.
- Simulators created with `xcrun simctl create` or `clone` inside the checkout. Simulators
  you made yourself are never deleted.
- Docker containers and volumes labelled `loom.lane=<lane id>`. The id is in `LOOM_LANE_ID`
  and in the lane's `LANE.md`.

Agents learn this from the lane tools and can hand other simulators or processes to their
lane. When a thread is settled or archived, its device panels close, and simulators no other
active thread is using are shut down. The Storage section lists each lane's leases with a
**Release** button.

## Build slots

Heavy Xcode builds (build, test, archive) take one of the machine's build slots and wait when
all are busy, so parallel agents do not slow the Mac to a crawl. Other builds can use
`lane-slot` the same way. The default is one slot per three CPU threads; change it in the
Storage settings.

## Terminal integration

Agents and terminals only use a lane when told where it is. **Install** terminal
integration in the Storage settings to add a short block to `~/.zshenv`. Inside a lane's
checkout, new zsh shells then point `TMPDIR` at the lane, `xcodebuild` writes DerivedData
and packages to the lane's `build` folder, and `lane-run`, `lane-slot` and the lane
variables are available. **Remove** takes the block out
again. Other shells and processes started outside zsh keep their usual locations.

## Managing storage

Open **Settings, Loom, Storage**, or choose **Storage and lanes** in the command palette.
You can turn lanes on or off, change the lanes folder and caps, and set how much free space
to keep on the disk. Each lane shows its usage and lets you free its `tmp` or `build`
folder, grow it, mount it again after a restart, or discard it.

Freed space returns to the disk when the lane is next mounted, which Loom does on its own
once no agent is running in that lane. A lane with open files cannot grow or be discarded
until the processes using it stop.

The lanes folder can only be moved while no lanes exist. Storage settings apply to the
selected environment and are available in the web and desktop clients.
