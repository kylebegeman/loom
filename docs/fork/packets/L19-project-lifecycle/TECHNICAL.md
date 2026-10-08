# L19 technical design

Phase 1: lanes. Phases 2 and 3 get their own design when they start.

## Overview

A lane is keyed by its checkout: `thread.worktreePath ?? project.workspaceRoot`, the same
value `RuntimePolicy` uses as the provider cwd. Every thread working in one checkout shares
its lane. The lane directory is `<lanesRoot>/<project>/<lane>/` and holds:

| Path          | What                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| `LANE.md`     | Plain description for humans and agents: checkout, cap, how to free space. |
| `space.asif`  | macOS only: the sparse ASIF disk image backing the space.                  |
| `space/`      | The mount point (image backend) or plain folder (folder backend).          |
| `space/tmp`   | Scratch. `TMPDIR` points here inside the checkout. Free scope `tmp`.       |
| `space/build` | DerivedData, SwiftPM checkouts, other build output. Free scope `build`.    |
| `space/data`  | Agent-made state worth keeping while the thread lives. Free scope `all`.   |

`<lanesRoot>/.loom/` holds the generated shell integration: `lanes.tsv` (checkout to space),
`lanes.zsh` (the hook) and `shims/xcodebuild`.

Everything lives in fork modules. Upstream files are not touched (see SEAMS).

## Contracts

`packages/contracts/src/fork/project-lifecycle.ts`:

- `ProjectLifecycleSettings`: `enabled`, `lanesRoot`, `defaultCapGb`, `appleCapGb`,
  `reserveGb`, `projectCapsGb` (project id to GB).
- `ProjectLifecycleLane`: id, project id and name, lane name, checkout, lane and space paths,
  backend (`image` or `folder`), state (`ready`, `unmounted`, `error`), cap, used and image
  bytes, thread ids, whether a thread is running, a message.
- `ProjectLifecycleStatus`: settings summary, backend available on this machine, host free
  and total bytes, reserve, `belowReserve`, shell integration state, lanes.
- `ProjectLifecycleError` with reasons `disabled`, `not-found`, `busy`, `no-room`,
  `unsupported`, `command-failed`.
- RPC tags `loom.project-lifecycle.<verb>`: `getSettings`, `updateSettings`, `watch` (stream
  of status snapshots), `free`, `grow`, `mount`, `discard`, `installShell`, `removeShell`.
  Reads need `orchestration:read`; everything else `orchestration:operate`.

## Server

`apps/server/src/fork/project-lifecycle/`:

| File                                | Role                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `policy.ts`                         | Pure decisions: cap for a project, lane naming, pressure actions for a lane and for the machine.            |
| `space.ts`                          | Backends. Image: `diskutil image create/attach/resize`, `diskutil unmount/eject`. Folder: `mkdir`, `du`.    |
| `shell.ts`                          | Renders `lanes.tsv`, `lanes.zsh`, the `xcodebuild` shim and the `~/.zshenv` block; installs and removes it. |
| `store.ts`                          | Settings and lane rows.                                                                                     |
| `ProjectLifecycleService.ts`        | Lane registry, reactor, watchdog, actions, status stream.                                                   |
| `rpc.ts`, `mcp.ts`, `migrations.ts` | Transport and tables.                                                                                       |

### Lane lifecycle

- **Ensure**: on `run.created`, resolve the thread's checkout from its shell and project.
  If no lane exists for it, create the lane directory, the space (image created at the cap,
  attached at `space/`, `.metadata_never_index` at its root, `tmp`, `build`, `data`
  created), write `LANE.md`, store the row and rewrite the index. Creation runs in the
  background and never delays the run. Each checkout has its own lock.
- **Reclaim**: on `thread.settled`, `thread.archived` and `thread.deleted`, and in the
  startup reconcile, a lane with no active holder is detached and its directory removed. A
  holder is a thread whose checkout is the lane's and which is neither archived nor settled
  (`settledOverride === "settled"`, or `settledAt` set without an `active` override). The
  checkout itself is never touched.
- **Reconcile at startup**: attach every image lane that is not mounted (images detach on
  reboot), reclaim lanes without holders, rewrite the shell files. Lanes stay mounted when the
  server stops so running processes keep their files across server restarts.

### Image backend facts (macOS 26+, probed on macOS 27)

- `diskutil image create blank --format ASIF --size <cap> --volumeName loom-<id> <img>`
  needs no root and takes about a second. An empty 2 GB image uses 15 MB.
- `diskutil image attach --mountPoint <space> <img>` prints the whole disk first
  (`/dev/diskN`); the row stores it for detach. `diskutil info -plist <space>` gives
  `APFSPhysicalStores` as a fallback.
- Detach is `diskutil unmount <space>` (fails while files are open, which Loom reports as
  `busy`) then `diskutil eject /dev/diskN`.
- Grow is detach, `diskutil image resize --size <new> <img>`, attach. The container fills
  the new size on attach. Resizing an attached image fails, and `apfs resizeContainer`
  remounts at `/Volumes`, so growth only happens with no running thread and no busy files.
- Deleting files lowers the volume's usage immediately, but the host gets the space back
  only when the volume is next attached (APFS trims free blocks at mount). The watchdog
  remounts idle lanes whose image is much larger than their usage. `hdiutil compact` does
  not support ASIF.
- An unmounted `space/` is an empty directory set to mode 0555, so writes to a stale lane
  path fail instead of filling the main disk. The lanes root is excluded from Time Machine
  with `tmutil addexclusion`.

The folder backend (non-macOS, or when image creation fails) measures usage with `du -sk`
every five minutes and treats the cap as soft: steering and clearing still apply, but writes
are not blocked.

### Pressure policy

The watchdog runs every 30 seconds while lanes are enabled. Per lane, with `used / cap`:

| Condition                                        | Action                                                  |
| ------------------------------------------------ | ------------------------------------------------------- |
| 75% or more and a thread is running              | Steer each running holder once per crossing.            |
| 90% or more and no thread running                | Clear `tmp`.                                            |
| Still 90% or more, idle, machine above reserve   | Grow by half, limited so the machine keeps its reserve. |
| Idle, image exceeds used by 10 GB and 25% of cap | Remount to return deleted space to the machine.         |

Machine-wide, when free space on the lanes volume drops below the reserve, every running
holder is steered once per episode and the status reports `belowReserve`, which clients
show as a notice. A lane's crossing resets when it falls below 60%; the machine episode
resets when free space recovers to the reserve plus 10 GB.

Steering uses `ThreadManagementService.sendToThread` with `mode: "steer"`,
`createdBy: "system"`, `creationSource: "server"` and deterministic command and message ids
per lane and crossing, so a retry cannot double-send.

### Shell integration

There is no per-thread provider environment hook upstream, and providers run every command
through the user's shell. Installing integration appends this block to `~/.zshenv`
(following its symlink):

```zsh
# >>> loom lanes >>>
[[ -r "<lanesRoot>/.loom/lanes.zsh" ]] && source "<lanesRoot>/.loom/lanes.zsh"
# <<< loom lanes <<<
```

`lanes.zsh` finds the longest checkout in `lanes.tsv` containing `$PWD` (logical or
resolved). If that lane's `space/tmp` is writable it exports `TMPDIR`, `LOOM_LANE_CHECKOUT`,
`LOOM_LANE_SPACE`, `LOOM_LANE_TMP`, `LOOM_LANE_BUILD` and `LOOM_LANE_DATA`, and puts the shims
first on `PATH`; otherwise it restores what it changed. Interactive shells re-run it on `cd`.

The `xcodebuild` shim adds `-derivedDataPath $LOOM_LANE_BUILD/DerivedData` and
`-clonedSourcePackagesDirPath $LOOM_LANE_BUILD/SourcePackages` to build actions that do not
pass them. When an agent passes a `/tmp` path that does not exist yet, the shim creates it as
a link into the lane's `build/redirect`. It never changes non-build invocations.

SwiftPM `.build` and Cargo `target` stay in the checkout: agents run binaries from those
paths, so moving them would break commands. Both are removed with the checkout.

## Storage

Fork tables, own migration set `fork_migrations_project_lifecycle`, no foreign keys:

- `fork_project_lifecycle_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`
- `fork_project_lifecycle_lanes (id TEXT PRIMARY KEY, checkout_path TEXT NOT NULL UNIQUE,
project_id TEXT NOT NULL, project_name TEXT NOT NULL, name TEXT NOT NULL,
lane_dir TEXT NOT NULL, backend TEXT NOT NULL, cap_bytes INTEGER NOT NULL, device TEXT,
created_at TEXT NOT NULL)`

Defaults are computed when no settings row exists: enabled, lanes root
`~/Developer/lanes` (a dev server uses `<stateDir>/fork/project-lifecycle/lanes` and starts
disabled, so a worktree dev server never touches the real lanes), caps 40 and 100 GB,
reserve 40 GB.

## Clients

- `packages/client-runtime/src/fork/project-lifecycle.ts`: settings query atom, status
  subscription atom, action helpers.
- Web: `apps/web/src/fork/project-lifecycle/` with the Storage settings section, a palette
  source and a root component that shows one notice per below-reserve episode.

## Agent-facing tools

`loom_project_lifecycle_status`, `loom_project_lifecycle_free` (`scope`: `tmp`, `build` or
`all`) and `loom_project_lifecycle_grow` act on the calling thread's lane, creating it if
needed. Status returns the lane paths and tells the agent to put scratch, build output and
large temporary data there. Free and grow refuse with `busy` when files are open.

## Performance

The watchdog calls `statfs` per lane (microseconds) and `du` only for folder lanes every five
minutes. Status snapshots go to clients only when a rounded value (100 MB) or a state
changes, so a building lane does not stream every tick. The shell hook reads one small file.

## Alternatives considered

- **Docker or VMs**: cannot run Xcode or simulators; macOS VMs are limited to two.
- **APFS volume quotas** (`diskutil apfs addVolume -quota`): needs the shared container and
  cannot change a quota after creation.
- **A folder per lane with `du` polling everywhere**: no hard cap, and polling large trees
  costs more than it saves. Kept only as the fallback backend.
- **Injecting env into providers**: no single upstream hook covers every provider and
  terminal; the shell hook covers all of them with zero seams. Candidate upstream PRs:
  per-thread provider environment, a worktree-removal hook, configurable safe ignored paths
  in worktree cleanup.
