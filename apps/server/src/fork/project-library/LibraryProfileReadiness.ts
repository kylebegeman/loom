import {
  LIBRARY_TOOL_CATALOG,
  type LibraryProfileReadiness,
  type LibraryProjectProfile,
  type LibraryRequiredTool,
  type LibraryToolCheck,
  type LibraryToolId,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as ProcessRunner from "../../processRunner.ts";

const PROBE_CONCURRENCY = 4;
// Several copies of one project often ask at once; a tool installed since shows up after this.
const PROBE_CACHE_MS = 30_000;
const VERSION = String.raw`(\d+(?:\.\d+)*)`;

/**
 * How one catalog tool is checked. The first command found wins; `darwinPaths` cover app
 * bundles that are often not on PATH. The first capture group of `version` is the version.
 */
interface ToolProbe {
  readonly commands: readonly [string, ...string[]];
  readonly args: readonly string[];
  readonly version: RegExp;
  readonly darwinPaths?: readonly string[];
  /** macOS ships a /usr/bin stub that offers to install developer tools instead of running. */
  readonly appleStub?: boolean;
}

const leading = (command: string, args: readonly string[] = ["--version"]): ToolProbe => ({
  commands: [command],
  args,
  version: new RegExp(`^v?${VERSION}`, "m"),
});

export const TOOL_PROBES: Record<LibraryToolId, ToolProbe> = {
  git: {
    commands: ["git"],
    args: ["--version"],
    version: new RegExp(`git version ${VERSION}`),
    appleStub: true,
  },
  node: leading("node"),
  pnpm: leading("pnpm"),
  npm: leading("npm"),
  yarn: leading("yarn"),
  bun: leading("bun"),
  deno: { commands: ["deno"], args: ["--version"], version: new RegExp(`^deno ${VERSION}`, "m") },
  python: {
    commands: ["python3", "python"],
    args: ["--version"],
    version: new RegExp(`Python ${VERSION}`),
    appleStub: true,
  },
  uv: { commands: ["uv"], args: ["--version"], version: new RegExp(`^uv ${VERSION}`, "m") },
  xcode: {
    commands: ["xcodebuild"],
    args: ["-version"],
    version: new RegExp(`^Xcode ${VERSION}`, "m"),
    appleStub: true,
  },
  swift: {
    commands: ["swift"],
    args: ["--version"],
    version: new RegExp(`Swift version ${VERSION}`),
    appleStub: true,
  },
  rust: { commands: ["rustc"], args: ["--version"], version: new RegExp(`^rustc ${VERSION}`, "m") },
  go: { commands: ["go"], args: ["version"], version: new RegExp(`go version go${VERSION}`) },
  java: { commands: ["java"], args: ["-version"], version: new RegExp(`version "${VERSION}`) },
  docker: {
    commands: ["docker"],
    args: ["--version"],
    version: new RegExp(`Docker version ${VERSION}`),
    darwinPaths: ["/Applications/Docker.app/Contents/Resources/bin/docker"],
  },
  openscad: {
    commands: ["openscad"],
    args: ["--version"],
    version: new RegExp(`OpenSCAD version ${VERSION}`),
    darwinPaths: [
      "/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD",
      "/Applications/OpenSCAD-Nightly.app/Contents/MacOS/OpenSCAD",
    ],
  },
  kicad: {
    ...leading("kicad-cli", ["version"]),
    darwinPaths: ["/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"],
  },
};

/** Output that means the tool is not really installed, though a command answered. */
const NOT_INSTALLED = [
  /requires Xcode, but active developer directory/,
  /xcode-select: error/,
  /Unable to locate a Java Runtime/,
];

/** What running a probe found. The reader gathers it; `judgeToolCheck` only judges it. */
export type ToolProbeResult =
  | { readonly kind: "not-found" }
  /** It could not run, timed out, or the check itself failed. */
  | { readonly kind: "failed" }
  | { readonly kind: "ran"; readonly code: number; readonly output: string };

const isCatalogTool = (id: string): id is LibraryToolId => Object.hasOwn(TOOL_PROBES, id);

/** At most four numeric parts of up to six digits, or null when the text is not a version. */
const normalizeVersion = (text: string): string | null => {
  const parts = text.split(".").slice(0, 4);
  return parts.every((part) => /^\d{1,6}$/.test(part)) ? parts.join(".") : null;
};

/** The version in a probe's output, or null when it cannot be read. */
export const parseToolVersion = (id: LibraryToolId, output: string): string | null => {
  const found = TOOL_PROBES[id].version.exec(output)?.[1];
  if (found === undefined) return null;
  // Java 8 and older report themselves as 1.8 and so on.
  const text = id === "java" && /^1\.\d/.test(found) ? found.slice(2) : found;
  return normalizeVersion(text);
};

/** Negative when `a` is older than `b`. Missing parts count as zero. */
export const compareVersions = (a: string, b: string) => {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

const labelFor = (id: string) => LIBRARY_TOOL_CATALOG.find((tool) => tool.id === id)?.label ?? id;

/**
 * Judges one required tool. Anything this computer cannot read with confidence is `unknown`,
 * never `ok`: a failed check, unreadable output, or a tool outside this computer's catalog.
 */
export const judgeToolCheck = (
  tool: LibraryRequiredTool,
  result: ToolProbeResult,
): LibraryToolCheck => {
  const base = {
    id: tool.id,
    label: labelFor(tool.id),
    ...(tool.minimumVersion === undefined ? {} : { minimumVersion: tool.minimumVersion }),
  };
  if (!isCatalogTool(tool.id)) return { ...base, status: "unknown" };
  if (result.kind === "not-found") return { ...base, status: "missing" };
  if (result.kind === "failed") return { ...base, status: "unknown" };
  if (NOT_INSTALLED.some((marker) => marker.test(result.output)))
    return { ...base, status: "missing" };
  const version = result.code === 0 ? parseToolVersion(tool.id, result.output) : null;
  if (version === null) return { ...base, status: "unknown" };
  const outdated =
    tool.minimumVersion !== undefined && compareVersions(version, tool.minimumVersion) < 0;
  return { ...base, status: outdated ? "outdated" : "ok", version };
};

/** Checks a profile's required tools on this computer and lists its secret names. */
export const makeProfileReadinessReader = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const cache = new Map<LibraryToolId, { readonly at: number; readonly result: ToolProbeResult }>();

  const run = (command: string, args: readonly string[]) =>
    runner
      .run({
        command,
        args,
        timeout: "10 seconds",
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: 64 * 1024,
        outputMode: "truncate",
      })
      .pipe(
        Effect.map((output): ToolProbeResult =>
          output.timedOut || output.code === null
            ? { kind: "failed" }
            : {
                kind: "ran",
                code: Number(output.code),
                output: `${output.stdout}\n${output.stderr}`,
              },
        ),
        Effect.orElseSucceed((): ToolProbeResult => ({ kind: "failed" })),
      );

  const locate = Effect.fn("LibraryProfileReadiness.locate")(function* (probe: ToolProbe) {
    for (const command of probe.commands) {
      const found = yield* resolveCommandPath(command).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
      if (found !== null) return found;
    }
    if ((yield* HostProcess.Platform) !== "darwin") return null;
    for (const candidate of probe.darwinPaths ?? [])
      if (yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))) return candidate;
    return null;
  });

  // Without developer tools, the /usr/bin stubs open an install dialog, so ask xcode-select.
  const developerToolsInstalled = run("xcode-select", ["-p"]).pipe(
    Effect.map((result) => (result.kind === "ran" ? result.code === 0 : null)),
  );

  const probeTool = Effect.fn("LibraryProfileReadiness.probe")(function* (id: LibraryToolId) {
    const probe = TOOL_PROBES[id];
    const command = yield* locate(probe);
    if (command === null) return { kind: "not-found" } as const;
    if (
      probe.appleStub &&
      command.startsWith("/usr/bin/") &&
      (yield* HostProcess.Platform) === "darwin"
    ) {
      const installed = yield* developerToolsInstalled;
      if (installed === null) return { kind: "failed" } as const;
      if (!installed) return { kind: "not-found" } as const;
    }
    return yield* run(command, probe.args);
  });

  const cachedProbe = Effect.fn("LibraryProfileReadiness.cachedProbe")(function* (
    id: LibraryToolId,
  ) {
    const at = yield* Clock.currentTimeMillis;
    const saved = cache.get(id);
    if (saved !== undefined && at - saved.at < PROBE_CACHE_MS) return saved.result;
    const result = yield* probeTool(id);
    cache.set(id, { at, result });
    return result;
  });

  return Effect.fn("LibraryProfileReadiness.read")(function* (input: {
    readonly projectId: string;
    readonly environmentId: LibraryProfileReadiness["environmentId"];
    readonly profile: LibraryProjectProfile;
  }) {
    const checks = yield* Effect.forEach(
      input.profile.requiredTools ?? [],
      (tool) =>
        isCatalogTool(tool.id)
          ? cachedProbe(tool.id).pipe(Effect.map((result) => judgeToolCheck(tool, result)))
          : Effect.succeed(judgeToolCheck(tool, { kind: "failed" })),
      { concurrency: PROBE_CONCURRENCY },
    );
    return {
      projectId: input.projectId,
      environmentId: input.environmentId,
      checks,
      secrets: (input.profile.secretNames ?? []).map((name) => ({ name })),
      checkedAt: yield* now,
    } satisfies LibraryProfileReadiness;
  });
});
