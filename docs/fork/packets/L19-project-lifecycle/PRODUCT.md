# L19 product

## Problem

Free space on Kyle's Mac swings by hundreds of gigabytes within 10 to 15 minutes during long
agent tasks, then fills the disk and blocks work. The space goes to output nobody owns:
DerivedData and package checkouts under `/tmp`, cloned simulators, copied server state, local
databases and build products. Agents are not allowed to delete freely, so the only cleanup is
Kyle asking every thread to remove what it made, or macOS purging `/tmp` after three days.

On 2026-10-08 one manual pass deleted 17 shut-down simulators (159 to 95 GB) and all
DerivedData (67 GB), taking free space from 53 to 148 GB. `/tmp` held another 100 GB that was
left alone because running agents were using it.

Containers were considered and ruled out on the Mac: Docker cannot run Xcode or simulators,
and macOS virtual machines are limited to two and are large. Docker remains an option for a
later Linux homelab lane backend.

## What the user can do

Lanes work without attention once enabled ("set it and forget it"):

- A thread's first run creates its lane. The agent's shell commands inside the checkout write
  scratch files and Xcode builds into the lane when shell integration is installed, and Loom's
  agent tools tell every agent where the lane is.
- A lane cannot grow past its cap. Before it fills, the running agent is told to clean up and
  can do so itself with the lane tools (free scratch, free build output, free everything
  rebuildable, or grow the lane when the machine has room).
- An idle lane that is nearly full has its scratch cleared, and an idle full lane grows by half
  when the machine is above its reserve.
- When the machine falls below its reserve, Loom shows a notice and asks running agents to
  free their lanes.
- When a thread settles, is archived or is deleted, and no other active thread uses the same
  checkout, its lane is thrown away.

In Loom settings, Storage:

- Turn lanes on or off, choose the lanes folder, set the default caps, per-project caps and
  the machine reserve.
- See every lane: project, checkout, used space against its cap, and its threads.
- Free scratch, free build output, grow, or discard a lane that has no running thread.
- Install or remove shell integration. Installing adds one marked line to `~/.zshenv`;
  removing deletes only that line.

## Entry points

- Settings, Loom, Storage.
- Command palette: "Storage and lanes" opens the section.
- A low-space notice links to the section.
- Agent tools: `loom_project_lifecycle_status`, `loom_project_lifecycle_free`,
  `loom_project_lifecycle_grow`.

## States

| State                     | What shows                                                                    |
| ------------------------- | ----------------------------------------------------------------------------- |
| Lanes off                 | The section explains lanes and offers the switch. Nothing is created.         |
| No lanes yet              | "Lanes appear when a thread starts work."                                     |
| Lane ready                | Used and cap, threads, actions.                                               |
| Lane near cap (75%+)      | Usage in warning color; its running agent has been asked to clean up once.    |
| Lane full                 | Usage in error color; writes fail inside the lane until it is freed or grown. |
| Lane not mounted          | "Not mounted" with a Mount action; scratch falls back to the usual places.    |
| Image backend unavailable | Lanes use plain folders with a soft cap, and the section says so.             |
| Machine below reserve     | A notice with free space and a link to Storage.                               |
| Shell integration missing | A prompt to install it, with what it changes.                                 |

## Surfaces and connection modes

The server owns lanes, so every client sees the same state over local, tailnet and T3 Connect
connections. Web and desktop show the Storage section and notices. Mobile shows nothing new.
A client connected to a server without the `project-lifecycle` capability hides the section.

## Decisions and open questions

Decided with Kyle on 2026-10-08:

1. Lanes live in one folder, `~/Developer/lanes`, one subfolder per project and per lane.
   Three projects look like this:

   ```
   ~/Developer/lanes/
     loom/
       main/                       threads working directly in active/loom
         LANE.md
         space.asif
         space/  tmp/ build/ data/
       loom-project-lifecycle/     a worktree lane
         LANE.md  space.asif  space/
     aspectavy/
       main/ ...
       people-redesign/ ...
     presence/
       main/ ...
   ```

   In phase 1 the checkout stays where the thread already has it (`~/Developer/active/<name>`
   or a worktree). Phase 3 moves checkouts under the lane as `checkout/`.

2. Caps from day one, generous: 100 GB for Apple projects and 40 GB for others. Images are
   sparse, so a cap costs only what is used. Agents must be able to clean their own lane and
   keep going unattended.
3. Reclaim on settle: scratch and build output go automatically. A checkout is removed only
   after its work is verified as published. Phase 1 leaves checkout removal to upstream's
   worktree cleanup rules (remove after merge), which already verify that.
4. A storage report is not important; the Storage section shows only lanes and machine space.

Open: none blocking phase 1. Phase 3 questions are below.

### Phase 2: leases

Simulators, databases, ports, long-running processes and build slots become leases owned by
a lane and released with it. AspectAvy agents already wrote their own build scheduler
(`st3-slot.sh`, six machine-wide slots), which shows the need.

Kyle's decisions (2026-10-08):

1. **Simulators: close and delete.** When a thread is released its device panels close, and
   devices no other active thread uses are shut down. Simulators the lane created are deleted
   with it. Simulators made outside lanes are never deleted.
2. **Processes: stop owned ones.** Processes started with the lane's run helper, and anything
   listening on the lane's ports, are stopped with the lane. Nothing is matched by name.
3. **Databases: Docker label lease.** Containers and volumes labelled `loom.lane=<lane id>`
   are removed with the lane. Agents are told to use the label.

Build slots are machine-wide: heavy Xcode builds wait for a free slot automatically, and
other builds can opt in.

### Phase 3: persistent machine pool

Agreed by Kyle on 2026-09-27; it follows lanes.

**My projects are available from one Loom app; choosing a machine should not require
manually preparing the repository.** Kyle's Mac and two homelab PCs are persistent machines
with persistent T3 state and thread history. Checkouts are disposable once their useful
contents are safely published.

1. Choose a project and start a thread on the Mac or a selected homelab machine. Automatic
   placement may reuse upstream's machine selection when it respects project requirements.
2. Resolve the repository and starting revision on that machine; reuse or prepare a checkout
   there, including project setup. With lanes, this checkout lives under the lane.
3. Run an ordinary T3 thread. Provider sessions, files, terminals and Git stay with that
   machine.
4. Publish completed work through commits and pushes according to an explicit project policy.
5. Reclaim the checkout only after verifying publication and accounting for anything unique
   on disk. Keep project and thread records so the repository can be prepared again.

| Concern                                 | Direction                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| Machine connections and agent execution | Reuse T3 environments and providers. Do not rebuild old Loom Core's runner system.   |
| Repository identity across machines     | Reuse upstream repository identity and project grouping.                             |
| Preparing missing checkouts             | Loom coordinates repository selection, clone or reuse, starting revision and setup.  |
| Publication and reclamation             | Loom owns the policy and visible progress and failures.                              |
| Runtime tools and credentials           | Belong to each machine; connecting one does not copy the Mac's tools or credentials. |
| Upstream maintenance                    | Policy stays in fork-owned modules with narrow integration points.                   |

Git is the handoff for published code, not live file synchronization. Cloud VM provisioning,
live thread migration and agent-initiated cross-machine delegation (L08) are out of scope.

Questions to settle when phase 3 starts: how a project stays discoverable with no checkout,
checkout reuse versus isolation, the publication trigger and policy (including WIP, failed
checks and conflicts), automatic versus manual reclamation of unique local files, recovery
after interrupted setup or publication, and how machine selection handles a project missing
from a machine. The earlier manual Repositories-page proposal (see REFERENCES) is input to
that work, not an approved design.
