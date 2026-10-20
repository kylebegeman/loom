import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ProcessRunner from "../../../processRunner.ts";
import {
  SLICER_LABELS,
  type SlicerApp,
  type SlicerInfo,
  type SlicerSettings,
} from "@t3tools/contracts/fork";
const encodePaths = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
);
export const slicerVersion = (text: string): string | null =>
  /(\d+\.\d+\.\d+(?:\.\d+)?)/.exec(text)?.[1] ?? null;
export const slicerCandidates = (
  app: SlicerApp,
  home: string,
  platform: NodeJS.Platform,
): readonly string[] => {
  const names = {
    "bambu-studio": "BambuStudio",
    "orca-slicer": "OrcaSlicer",
    "prusa-slicer": "PrusaSlicer",
  };
  if (platform === "darwin")
    return app === "prusa-slicer"
      ? [
          "/Applications/Original Prusa Drivers/PrusaSlicer.app/Contents/MacOS/PrusaSlicer",
          "/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer",
        ]
      : [
          `/Applications/${names[app]}.app/Contents/MacOS/${names[app]}`,
          `${home}/Applications/${names[app]}.app/Contents/MacOS/${names[app]}`,
        ];
  if (platform === "win32")
    return [
      {
        "bambu-studio": "C:\\Program Files\\Bambu Studio\\bambu-studio.exe",
        "orca-slicer": "C:\\Program Files\\OrcaSlicer\\orca-slicer.exe",
        "prusa-slicer": "C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer-console.exe",
      }[app],
    ];
  return [app];
};
export const makeSlicerDetection = Effect.fn("Slicer.makeDetection")(function* (
  home: string,
  settings: () => SlicerSettings,
) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    runner = yield* ProcessRunner.ProcessRunner;
  let cached: { at: number; paths: string; infos: SlicerInfo[] } | null = null;
  const detect = Effect.fn("Slicer.detect")(function* (refresh = false) {
    const paths = yield* encodePaths(settings().paths);
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    if (!refresh && cached && cached.paths === paths && now - cached.at < 60000)
      return cached.infos;
    const infos = yield* Effect.forEach(
      Object.keys(SLICER_LABELS) as SlicerApp[],
      (app) =>
        Effect.gen(function* () {
          const platform = yield* HostProcess.Platform;
          const configured = settings().paths[app],
            candidates = configured ? [configured] : slicerCandidates(app, home, platform);
          for (const executable of candidates) {
            if (
              path.isAbsolute(executable) &&
              !(yield* fs.exists(executable).pipe(Effect.orElseSucceed(() => false)))
            )
              continue;
            // Bambu Studio and OrcaSlicer write result.json into their working directory even
            // for --help, so probe from a scratch directory instead of the server's.
            const result = yield* Effect.scoped(
              Effect.gen(function* () {
                const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "loom-slicer-probe-" });
                return yield* runner.run({
                  command: executable,
                  args: ["--help"],
                  cwd,
                  timeout: "10 seconds",
                  timeoutBehavior: "timedOutResult",
                  maxOutputBytes: 64 * 1024,
                  outputMode: "truncate",
                });
              }),
            ).pipe(Effect.option);
            let version =
              result._tag === "Some"
                ? slicerVersion(result.value.stdout || result.value.stderr)
                : null;
            if (!version && executable.includes(".app/")) {
              const bundle = executable.slice(0, executable.indexOf(".app/") + 4);
              const text = yield* fs
                .readFileString(path.join(bundle, "Contents", "Info.plist"))
                .pipe(Effect.orElseSucceed(() => ""));
              version =
                /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(
                  text,
                )?.[1] ?? null;
            }
            if (version) {
              const [major, minor] = version.split(".").map(Number);
              const supported =
                app === "bambu-studio"
                  ? major! > 2 || (major === 2 && minor! >= 8)
                  : app === "orca-slicer"
                    ? major === 2 && minor! >= 4
                    : major === 2 && minor! >= 8;
              return { app, path: executable, version, supported };
            }
          }
          return { app, path: null, version: null, supported: false };
        }),
      { concurrency: 3 },
    );
    cached = { at: now, paths, infos };
    return infos;
  });
  return {
    detect,
    reset: () => {
      cached = null;
    },
  };
});
