// @effect-diagnostics nodeBuiltinImport:off - Effect has no free-space or device id query.
import * as NodeFSP from "node:fs/promises";
import { ProjectLifecycleError, type LaneBackend } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ProcessRunner } from "../../processRunner.ts";
import { GB } from "./policy.ts";

/** Where a lane's space lives. The image file exists only for the image backend. */
export interface LanePaths {
  readonly laneDir: string;
  readonly spacePath: string;
  readonly imagePath: string;
}

export const SPACE_FOLDERS = ["tmp", "build", "data"] as const;

type Op<A> = Effect.Effect<A, ProjectLifecycleError>;

/** One lane space backend. `device` identifies an attached image for detaching. */
export interface SpaceOps {
  readonly backend: LaneBackend;
  readonly isMounted: (lane: LanePaths) => Effect.Effect<boolean>;
  readonly create: (
    lane: LanePaths,
    capBytes: number,
    volumeName: string,
  ) => Op<{ readonly device: string | null }>;
  /** Mounts the space, starting an empty one when its image or folder is gone. */
  readonly attach: (
    lane: LanePaths,
    capBytes: number,
    volumeName: string,
  ) => Op<{ readonly device: string | null }>;
  readonly detach: (lane: LanePaths, device: string | null) => Op<void>;
  readonly resize: (
    lane: LanePaths,
    capBytes: number,
    device: string | null,
  ) => Op<{ readonly device: string | null }>;
  readonly usage: (
    lane: LanePaths,
  ) => Effect.Effect<{ readonly usedBytes: number; readonly imageBytes: number | null } | null>;
}

/** ASIF images need macOS 26 (Darwin 25) or later. */
export const imageBackendAvailable = (platform: NodeJS.Platform, release: string) =>
  platform === "darwin" && Number(release.split(".")[0]) >= 25;

/** `diskutil image attach` lists the image's whole disk first. */
export const parseAttachDevice = (stdout: string) =>
  /^(\/dev\/disk\d+)\s/m.exec(stdout)?.[1] ?? null;

/** The whole disk behind an APFS physical store such as `disk17s1`. */
export const wholeDisk = (store: string) => {
  const match = /^(?:\/dev\/)?(disk\d+)/.exec(store);
  return match === null ? null : `/dev/${match[1]}`;
};

/** diskutil reports open files as a dissent from the process holding them. */
export const unmountBusy = (output: string) => /dissented|busy|in use/i.test(output);

const failed = (message: string, reason: ProjectLifecycleError["reason"] = "command-failed") =>
  new ProjectLifecycleError({ reason, message });

const node = <A>(label: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => failed(`${label}: ${String(cause)}`) });

const DiskInfoJson = Schema.fromJsonString(
  Schema.Struct({
    APFSPhysicalStores: Schema.optional(
      Schema.Array(Schema.Struct({ APFSPhysicalStore: Schema.optional(Schema.String) })),
    ),
  }),
);

const decodeDiskInfo = Schema.decodeEffect(DiskInfoJson);

const sizeArg = (bytes: number) => `${Math.max(1, Math.round(bytes / GB))}g`;

export const makeSpaceOps = Effect.gen(function* () {
  const runner = yield* ProcessRunner;

  const run = (command: string, args: ReadonlyArray<string>, stdin?: string) =>
    runner
      .run({ command, args, stdin, timeout: "2 minutes", maxOutputBytes: 256 * 1024 })
      .pipe(Effect.mapError((error) => failed(`${command} ${args[0] ?? ""}: ${error.message}`)));

  const runOk = (command: string, args: ReadonlyArray<string>) =>
    run(command, args).pipe(
      Effect.flatMap((output) =>
        output.code === 0
          ? Effect.succeed(output.stdout)
          : Effect.fail(
              failed(`${command} ${args.join(" ")}: ${(output.stderr || output.stdout).trim()}`),
            ),
      ),
    );

  const isMounted = (lane: LanePaths) =>
    node("stat", async () => {
      const [space, parent] = await Promise.all([
        NodeFSP.stat(lane.spacePath),
        NodeFSP.stat(lane.laneDir),
      ]);
      return space.dev !== parent.dev;
    }).pipe(Effect.orElseSucceed(() => false));

  const prepareSpace = (lane: LanePaths) =>
    node("prepare space", async () => {
      await NodeFSP.writeFile(`${lane.spacePath}/.metadata_never_index`, "");
      for (const folder of SPACE_FOLDERS)
        await NodeFSP.mkdir(`${lane.spacePath}/${folder}`, { recursive: true });
    });

  /** An unmounted mount point refuses writes, so stale lane paths cannot fill the main disk. */
  const lockMountPoint = (lane: LanePaths) =>
    node("lock mount point", () => NodeFSP.chmod(lane.spacePath, 0o555));

  const mount = (lane: LanePaths) =>
    Effect.gen(function* () {
      if (yield* isMounted(lane)) return { device: yield* deviceOf(lane) };
      const stdout = yield* runOk("diskutil", [
        "image",
        "attach",
        "--mountPoint",
        lane.spacePath,
        lane.imagePath,
      ]);
      const device = parseAttachDevice(stdout);
      if (!(yield* isMounted(lane)))
        return yield* failed(`The lane image did not mount at ${lane.spacePath}.`);
      yield* prepareSpace(lane);
      return { device };
    });

  const deviceOf = (lane: LanePaths) =>
    Effect.gen(function* () {
      const plist = yield* runOk("diskutil", ["info", "-plist", lane.spacePath]);
      const json = yield* run("plutil", ["-convert", "json", "-o", "-", "-"], plist);
      const info = yield* decodeDiskInfo(json.stdout);
      const store = info.APFSPhysicalStores?.[0]?.APFSPhysicalStore;
      return store === undefined ? null : wholeDisk(store);
    }).pipe(Effect.orElseSucceed(() => null));

  const detach = (lane: LanePaths, knownDevice: string | null) =>
    Effect.gen(function* () {
      if (!(yield* isMounted(lane))) return;
      const device = (yield* deviceOf(lane)) ?? knownDevice;
      const unmount = yield* run("diskutil", ["unmount", lane.spacePath]);
      if (unmount.code !== 0) {
        const output = `${unmount.stdout}\n${unmount.stderr}`.trim();
        return yield* unmountBusy(output)
          ? failed(
              "Files in this lane are open. Stop the processes using it, then try again.",
              "busy",
            )
          : failed(`diskutil unmount: ${output}`);
      }
      if (device !== null) yield* runOk("diskutil", ["eject", device]).pipe(Effect.ignore);
      yield* lockMountPoint(lane);
    });

  const createImage = (lane: LanePaths, capBytes: number, volumeName: string) =>
    Effect.gen(function* () {
      yield* node("create lane", () => NodeFSP.mkdir(lane.spacePath, { recursive: true }));
      yield* runOk("diskutil", [
        "image",
        "create",
        "blank",
        "--format",
        "ASIF",
        "--size",
        sizeArg(capBytes),
        "--volumeName",
        volumeName,
        lane.imagePath,
      ]);
      return yield* mount(lane);
    });

  const image: SpaceOps = {
    backend: "image",
    isMounted,
    create: createImage,
    attach: (lane: LanePaths, capBytes: number, volumeName: string) =>
      Effect.gen(function* () {
        if (yield* isMounted(lane)) return yield* mount(lane);
        const imageExists = yield* node("stat image", () => NodeFSP.access(lane.imagePath)).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        // A lane folder deleted outside Loom takes its image along.
        return yield* imageExists ? mount(lane) : createImage(lane, capBytes, volumeName);
      }),
    detach,
    /** The lane must be detached; attaching again fills the container to the new size. */
    resize: (lane: LanePaths, capBytes: number, device: string | null) =>
      Effect.gen(function* () {
        yield* detach(lane, device);
        yield* runOk("diskutil", ["image", "resize", "--size", sizeArg(capBytes), lane.imagePath]);
        return yield* mount(lane);
      }),
    usage: (lane: LanePaths) =>
      Effect.gen(function* () {
        if (!(yield* isMounted(lane))) return null;
        const stats = yield* node("statfs", () => NodeFSP.statfs(lane.spacePath));
        const file = yield* node("stat image", () => NodeFSP.stat(lane.imagePath));
        return {
          usedBytes: (stats.blocks - stats.bfree) * stats.bsize,
          imageBytes: file.blocks * 512,
        };
      }).pipe(Effect.orElseSucceed(() => null)),
  };

  const folder: SpaceOps = {
    backend: "folder",
    isMounted: (lane: LanePaths) =>
      node("stat", () => NodeFSP.access(`${lane.spacePath}/tmp`)).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      ),
    create: (lane: LanePaths, _capBytes: number, _volumeName: string) =>
      prepareFolder(lane).pipe(Effect.as({ device: null })),
    attach: (lane: LanePaths, _capBytes: number, _volumeName: string) =>
      prepareFolder(lane).pipe(Effect.as({ device: null })),
    detach: (_lane: LanePaths, _device: string | null) => Effect.void,
    resize: (_lane: LanePaths, _capBytes: number, _device: string | null) =>
      Effect.succeed({ device: null }),
    usage: (lane: LanePaths) =>
      runOk("du", ["-sk", lane.spacePath]).pipe(
        Effect.map((stdout) => {
          const kilobytes = Number(stdout.trim().split(/\s+/)[0]);
          return Number.isFinite(kilobytes)
            ? { usedBytes: kilobytes * 1024, imageBytes: null }
            : null;
        }),
        Effect.orElseSucceed(() => null),
      ),
  };

  const prepareFolder = (lane: LanePaths) =>
    node("create lane", async () => {
      for (const name of SPACE_FOLDERS)
        await NodeFSP.mkdir(`${lane.spacePath}/${name}`, { recursive: true });
    });

  return { image, folder };
});
