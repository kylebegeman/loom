// @effect-diagnostics nodeBuiltinImport:off - The image test writes through the real mount.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ProcessRunner from "../../processRunner.ts";
import { GB } from "./policy.ts";
import {
  imageBackendAvailable,
  makeSpaceOps,
  parseAttachDevice,
  unmountBusy,
  wholeDisk,
} from "./space.ts";

describe("diskutil output", () => {
  it("finds the image's whole disk and recognises a busy unmount", () => {
    expect(
      parseAttachDevice(
        "/dev/disk17  \tGUID_partition_scheme\n/dev/disk17s1\tApple_APFS\n/dev/disk18  \tApple_APFS_Container\n",
      ),
    ).toBe("/dev/disk17");
    expect(parseAttachDevice("nothing")).toBeNull();
    expect(wholeDisk("disk17s1")).toBe("/dev/disk17");
    expect(unmountBusy("Volume loom on disk18s1 failed to unmount: dissented by PID 42")).toBe(
      true,
    );
    expect(imageBackendAvailable("linux", "6.1.0")).toBe(false);
    expect(imageBackendAvailable("darwin", "24.6.0")).toBe(false);
    expect(imageBackendAvailable("darwin", "27.0.0")).toBe(true);
  });
});

/** A lane in a fresh temp folder; nothing mounts there, so its space stays a plain folder. */
const tempLane = Effect.acquireRelease(
  Effect.sync(() => {
    const laneDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-lane-stub-"));
    return {
      laneDir,
      spacePath: NodePath.join(laneDir, "space"),
      imagePath: NodePath.join(laneDir, "space.asif"),
    };
  }),
  (lane) => Effect.sync(() => NodeFS.rmSync(lane.laneDir, { recursive: true, force: true })),
);

/** Records each command and answers from `respond`; no diskutil ever runs. */
const scriptedRunner = (
  respond: (line: string) => {
    readonly code: number;
    readonly stdout?: string;
    readonly stderr?: string;
  },
) => {
  const calls: Array<string> = [];
  const runner = ProcessRunner.ProcessRunner.of({
    run: (input) =>
      Effect.sync(() => {
        const line = [input.command, ...input.args].join(" ");
        calls.push(line);
        const reply = respond(line);
        return {
          stdout: reply.stdout ?? "",
          stderr: reply.stderr ?? "",
          code: ChildProcessSpawner.ExitCode(reply.code),
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        };
      }),
  });
  return { calls, runner };
};

describe("image backend commands", () => {
  it.live("creates and resizes an ASIF image, and refuses a mount that did not happen", () =>
    Effect.gen(function* () {
      const lane = yield* tempLane;
      const { calls, runner } = scriptedRunner((line) =>
        line.startsWith("diskutil image attach")
          ? { code: 0, stdout: "/dev/disk17  \tGUID_partition_scheme\n" }
          : { code: 0 },
      );
      const { image } = yield* makeSpaceOps.pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, runner),
      );
      const attach = `diskutil image attach --mountPoint ${lane.spacePath} ${lane.imagePath}`;

      const created = yield* image.create(lane, 1.4 * GB, "loom-app").pipe(Effect.flip);
      expect(created.message).toContain("did not mount");
      expect(NodeFS.existsSync(lane.spacePath)).toBe(true);
      expect(calls).toEqual([
        `diskutil image create blank --format ASIF --size 1g --volumeName loom-app ${lane.imagePath}`,
        attach,
      ]);

      // An unmounted lane needs no unmount before resizing.
      calls.length = 0;
      yield* image.resize(lane, 2 * GB, "/dev/disk17").pipe(Effect.flip);
      expect(calls).toEqual([`diskutil image resize --size 2g ${lane.imagePath}`, attach]);
      expect(yield* image.usage(lane)).toBeNull();
    }).pipe(Effect.scoped),
  );

  it.live("starts an empty image when the lane's image is gone, and reuses one that exists", () =>
    Effect.gen(function* () {
      const lane = yield* tempLane;
      const { calls, runner } = scriptedRunner(() => ({ code: 0 }));
      const { image } = yield* makeSpaceOps.pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, runner),
      );
      const attach = `diskutil image attach --mountPoint ${lane.spacePath} ${lane.imagePath}`;

      // Nothing mounts in the test, so both attempts end in the mount check.
      yield* image.attach(lane, 2 * GB, "loom-app").pipe(Effect.flip);
      expect(calls).toEqual([
        `diskutil image create blank --format ASIF --size 2g --volumeName loom-app ${lane.imagePath}`,
        attach,
      ]);

      calls.length = 0;
      NodeFS.writeFileSync(lane.imagePath, "");
      yield* image.attach(lane, 2 * GB, "loom-app").pipe(Effect.flip);
      expect(calls).toEqual([attach]);
    }).pipe(Effect.scoped),
  );

  it.live("reports diskutil's own error when creating fails", () =>
    Effect.gen(function* () {
      const lane = yield* tempLane;
      const { calls, runner } = scriptedRunner(() => ({
        code: 1,
        stderr: "Could not create image: No space left on device\n",
      }));
      const { image } = yield* makeSpaceOps.pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, runner),
      );
      const error = yield* image.create(lane, GB, "loom-app").pipe(Effect.flip);
      expect(error.reason).toBe("command-failed");
      expect(error.message).toContain("No space left on device");
      expect(calls).toHaveLength(1);
    }).pipe(Effect.scoped),
  );
});

const runnerLayer = ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer));

/**
 * Creates, mounts and resizes a real disk image. Opt in with LOOM_TEST_IMAGE_BACKEND=1: a hung
 * diskimages service stalls diskutil past any test timeout and leaves the image attached.
 */
describe.runIf(
  process.env.LOOM_TEST_IMAGE_BACKEND === "1" &&
    imageBackendAvailable(HostProcess.Platform.defaultValue(), NodeOS.release()),
)("image backend on this host", () => {
  it.live(
    "creates a capped volume, refuses writes once detached, and grows",
    () =>
      Effect.gen(function* () {
        const { image } = yield* makeSpaceOps;
        const laneDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-lane-"));
        const lane = {
          laneDir,
          spacePath: NodePath.join(laneDir, "space"),
          imagePath: NodePath.join(laneDir, "space.asif"),
        };
        yield* Effect.addFinalizer(() =>
          image.detach(lane, null).pipe(
            Effect.ignore,
            Effect.andThen(
              Effect.sync(() => {
                NodeFS.chmodSync(lane.spacePath, 0o755);
                NodeFS.rmSync(laneDir, { recursive: true, force: true });
              }),
            ),
          ),
        );
        const created = yield* image.create(lane, GB, `loom-test-${process.pid}`);
        expect(created.device).toMatch(/^\/dev\/disk\d+$/);
        expect(yield* image.isMounted(lane)).toBe(true);
        expect(NodeFS.readdirSync(lane.spacePath)).toEqual(
          expect.arrayContaining(["tmp", "build", "data", ".metadata_never_index"]),
        );
        NodeFS.writeFileSync(
          NodePath.join(lane.spacePath, "tmp", "blob"),
          Buffer.alloc(50_000_000),
        );
        const usage = yield* image.usage(lane);
        expect(usage!.usedBytes).toBeGreaterThan(40_000_000);

        yield* image.detach(lane, created.device);
        expect(yield* image.isMounted(lane)).toBe(false);
        expect(() => NodeFS.writeFileSync(NodePath.join(lane.spacePath, "stray"), "x")).toThrow();

        yield* image.attach(lane, GB, `loom-test-${process.pid}`);
        expect(NodeFS.existsSync(NodePath.join(lane.spacePath, "tmp", "blob"))).toBe(true);
        const grown = yield* image.resize(lane, 2 * GB, null);
        expect(grown.device).toMatch(/^\/dev\/disk\d+$/);
        expect(
          NodeFS.statfsSync(lane.spacePath).blocks * NodeFS.statfsSync(lane.spacePath).bsize,
        ).toBeGreaterThan(1.5 * GB);
      }).pipe(Effect.scoped, Effect.provide(runnerLayer)),
    60_000,
  );
});
