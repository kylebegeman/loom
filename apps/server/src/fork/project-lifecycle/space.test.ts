// @effect-diagnostics nodeBuiltinImport:off - The image test writes through the real mount.
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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

const runnerLayer = ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer));

describe.skipIf(!imageBackendAvailable())("image backend", () => {
  it.live(
    "creates a capped volume, refuses writes once detached, and grows",
    () =>
      Effect.gen(function* () {
        const { image } = yield* makeSpaceOps;
        const laneDir = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "loom-lane-"));
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
                NodeFs.chmodSync(lane.spacePath, 0o755);
                NodeFs.rmSync(laneDir, { recursive: true, force: true });
              }),
            ),
          ),
        );
        const created = yield* image.create(lane, GB, `loom-test-${process.pid}`);
        expect(created.device).toMatch(/^\/dev\/disk\d+$/);
        expect(yield* image.isMounted(lane)).toBe(true);
        expect(NodeFs.readdirSync(lane.spacePath)).toEqual(
          expect.arrayContaining(["tmp", "build", "data", ".metadata_never_index"]),
        );
        NodeFs.writeFileSync(
          NodePath.join(lane.spacePath, "tmp", "blob"),
          Buffer.alloc(50_000_000),
        );
        const usage = yield* image.usage(lane);
        expect(usage!.usedBytes).toBeGreaterThan(40_000_000);

        yield* image.detach(lane, created.device);
        expect(yield* image.isMounted(lane)).toBe(false);
        expect(() => NodeFs.writeFileSync(NodePath.join(lane.spacePath, "stray"), "x")).toThrow();

        yield* image.attach(lane);
        expect(NodeFs.existsSync(NodePath.join(lane.spacePath, "tmp", "blob"))).toBe(true);
        const grown = yield* image.resize(lane, 2 * GB, null);
        expect(grown.device).toMatch(/^\/dev\/disk\d+$/);
        expect(
          NodeFs.statfsSync(lane.spacePath).blocks * NodeFs.statfsSync(lane.spacePath).bsize,
        ).toBeGreaterThan(1.5 * GB);
      }).pipe(Effect.scoped, Effect.provide(runnerLayer)),
    60_000,
  );
});
