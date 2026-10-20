import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { DEFAULT_MODEL_PREVIEW_SETTINGS } from "@t3tools/contracts/fork";
import { ProcessRunner, type ProcessRunOutput } from "../../../processRunner.ts";
import { makeSlicerDetection, slicerCandidates, slicerVersion } from "./detect.ts";
it("reads installed CLI versions after initialization messages and bounds platform discovery", () => {
  expect(
    slicerVersion(
      "[trace] Initializing StaticPrintConfigs\nBambuStudio-02.08.04.57:\nUsage: bambu-studio",
    ),
  ).toBe("02.08.04.57");
  expect(slicerVersion("PrusaSlicer 2.9.1 based on Slic3r")).toBe("2.9.1");
  expect(slicerVersion("No executable")).toBeNull();
  expect(slicerCandidates("bambu-studio", "/home/kyle", "darwin")).toContain(
    "/Applications/BambuStudio.app/Contents/MacOS/BambuStudio",
  );
  expect(slicerCandidates("prusa-slicer", "/home/kyle", "linux")).toEqual(["prusa-slicer"]);
});
it.effect("probes from a scratch directory so slicer side files never reach the server cwd", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      path = yield* Path.Path,
      root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-slicer-detect-" }),
      executable = path.join(root, "bambu-studio");
    yield* fs.writeFileString(executable, "fixture");
    const probes: string[] = [];
    const runner = ProcessRunner.of({
      run: (input) =>
        Effect.gen(function* () {
          if (input.command !== executable) return yield* Effect.die("unexpected executable");
          probes.push(input.cwd ?? "");
          // Mirrors Bambu Studio, which writes its run summary into the working directory.
          if (input.cwd) yield* fs.writeFileString(path.join(input.cwd, "result.json"), "{}");
          return {
            stdout: "BambuStudio-02.08.04.57:\nUsage: bambu-studio",
            stderr: "",
            code: 0 as ProcessRunOutput["code"],
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          };
        }).pipe(Effect.orDie),
    });
    const detection = yield* makeSlicerDetection(root, () => ({
      ...DEFAULT_MODEL_PREVIEW_SETTINGS.slicer,
      paths: {
        "bambu-studio": executable,
        "orca-slicer": path.join(root, "missing-orca"),
        "prusa-slicer": path.join(root, "missing-prusa"),
      },
    })).pipe(Effect.provideService(ProcessRunner, runner));
    const infos = yield* detection.detect();
    expect(infos.find((info) => info.app === "bambu-studio")).toMatchObject({
      path: executable,
      version: "02.08.04.57",
      supported: true,
    });
    expect(probes).toHaveLength(1);
    expect(probes[0]).not.toBe("");
    expect(probes[0]).not.toBe(process.cwd());
    expect(yield* fs.exists(probes[0]!)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
