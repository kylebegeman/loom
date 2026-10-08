// @effect-diagnostics nodeBuiltinImport:off - Builds a mirror folder of links to generate into.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { truncateUtf8, type AppleXcodegenReport } from "@t3tools/contracts/fork";
import { createTwoFilesPatch } from "diff";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { succeeded, type Exec } from "./process.ts";

export const DIFF_LIMIT_BYTES = 200 * 1024;
/** A spec folder with more entries than this is not mirrored. */
const MIRROR_MAX_ENTRIES = 20_000;
const MIRROR_SKIPPED = new Set([".git", "node_modules", "DerivedData", ".build"]);
/** XcodeGen may write these from the spec; a link would let it write into the real folder. */
const COPIED_EXTENSIONS = new Set([".plist", ".entitlements"]);

const report = (
  spec: string,
  fields: Partial<AppleXcodegenReport> & Pick<AppleXcodegenReport, "state">,
): AppleXcodegenReport => ({
  spec,
  valid: fields.state !== "invalid" && fields.state !== "xcodegen-missing",
  error: null,
  diff: null,
  diffTruncated: false,
  changedSchemes: [],
  ...fields,
});

const decodeDump = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ name: Schema.String })),
);

/** The `name` in `xcodegen dump --type json`, which names the generated project. */
const projectName = (json: string) =>
  Option.match(decodeDump(json), {
    onNone: () => null,
    onSome: (dump) => dump.name.trim() || null,
  });

const readOrNull = (path: string) => NodeFSP.readFile(path, "utf8").catch(() => null);

const schemesIn = async (project: string) => {
  const dir = NodePath.join(project, "xcshareddata", "xcschemes");
  const names = await NodeFSP.readdir(dir).catch(() => []);
  const schemes = new Map<string, string>();
  for (const name of names.filter((entry) => entry.endsWith(".xcscheme")))
    schemes.set(
      name.slice(0, -".xcscheme".length),
      (await readOrNull(NodePath.join(dir, name))) ?? "",
    );
  return schemes;
};

/**
 * Real folders with links to every file, except the generated project and copied plists. XcodeGen
 * output depends on the project's location, so generating in the mirror at the same relative
 * place gives byte-identical files when nothing changed.
 */
const buildMirror = async (source: string, target: string, excluded: string) => {
  let entries = 0;
  const walk = async (from: string, to: string) => {
    await NodeFSP.mkdir(to, { recursive: true });
    for (const entry of await NodeFSP.readdir(from, { withFileTypes: true })) {
      if (++entries > MIRROR_MAX_ENTRIES)
        throw new Error("The spec folder is too large to compare.");
      const fromPath = NodePath.join(from, entry.name);
      const toPath = NodePath.join(to, entry.name);
      if (fromPath === excluded || MIRROR_SKIPPED.has(entry.name)) continue;
      if (entry.isDirectory()) await walk(fromPath, toPath);
      else if (COPIED_EXTENSIONS.has(NodePath.extname(entry.name)))
        await NodeFSP.copyFile(fromPath, toPath);
      else await NodeFSP.symlink(fromPath, toPath);
    }
  };
  await walk(source, target);
};

/** Validates a spec and compares what it would generate with the project on disk. */
export const xcodegenReport = (input: {
  readonly exec: Exec;
  readonly xcodegen: string | null;
  readonly cwd: string;
  /** Workspace-relative. */
  readonly spec: string;
  readonly scratchDir: string;
}) =>
  Effect.gen(function* () {
    const { exec, spec } = input;
    if (input.xcodegen === null)
      return report(spec, {
        state: "xcodegen-missing",
        error: "XcodeGen is not installed. Install it with `brew install xcodegen`.",
      });
    const specPath = NodePath.join(input.cwd, spec);
    const specDir = NodePath.dirname(specPath);
    // `--quiet` would suppress the JSON itself.
    const dump = yield* exec(
      input.xcodegen,
      ["dump", "--spec", specPath, "--project-root", specDir, "--type", "json"],
      { timeoutSeconds: 60, maxOutputBytes: 32 * 1024 * 1024 },
    );
    if (!succeeded(dump))
      return report(spec, {
        state: "invalid",
        error: (dump?.stderr || dump?.stdout || "xcodegen dump failed.").trim(),
      });
    const name = projectName(dump.stdout);
    if (name === null)
      return report(spec, { state: "invalid", error: "The spec has no project name." });

    const projectDir = NodePath.join(specDir, `${name}.xcodeproj`);
    const current = yield* Effect.promise(() =>
      readOrNull(NodePath.join(projectDir, "project.pbxproj")),
    );
    if (current === null) return report(spec, { state: "not-generated" });

    yield* Effect.promise(() => NodeFSP.mkdir(input.scratchDir, { recursive: true }));
    const scratch = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(input.scratchDir, "xcodegen-")),
    );
    return yield* Effect.gen(function* () {
      const mirrorDir = NodePath.join(scratch, "spec");
      const mirrored = yield* Effect.promise(() =>
        buildMirror(specDir, mirrorDir, projectDir).then(
          () => null,
          (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
        ),
      );
      if (mirrored !== null) return report(spec, { state: "out-of-date", error: mirrored });
      const generate = yield* exec(
        input.xcodegen!,
        [
          "generate",
          "--spec",
          NodePath.join(mirrorDir, NodePath.basename(specPath)),
          "--project",
          mirrorDir,
          "--project-root",
          mirrorDir,
          "--quiet",
        ],
        { cwd: mirrorDir, timeoutSeconds: 120 },
      );
      if (!succeeded(generate))
        return report(spec, {
          state: "invalid",
          error: (generate?.stderr || generate?.stdout || "xcodegen generate failed.").trim(),
        });
      const mirrorProject = NodePath.join(mirrorDir, `${name}.xcodeproj`);
      const [generated, before, after] = yield* Effect.promise(() =>
        Promise.all([
          readOrNull(NodePath.join(mirrorProject, "project.pbxproj")),
          schemesIn(projectDir),
          schemesIn(mirrorProject),
        ]),
      );
      const changedSchemes = [...new Set([...before.keys(), ...after.keys()])]
        .filter((scheme) => before.get(scheme) !== after.get(scheme))
        .sort();
      if (generated === current && changedSchemes.length === 0)
        return report(spec, { state: "in-sync" });
      const patch =
        generated === current
          ? null
          : createTwoFilesPatch(
              `a/${name}.xcodeproj/project.pbxproj`,
              `b/${name}.xcodeproj/project.pbxproj`,
              current,
              generated ?? "",
            );
      const diff = patch === null ? null : truncateUtf8(patch, DIFF_LIMIT_BYTES);
      return report(spec, {
        state: "out-of-date",
        diff,
        diffTruncated: diff !== patch,
        changedSchemes,
      });
    }).pipe(
      Effect.ensuring(Effect.promise(() => NodeFSP.rm(scratch, { recursive: true, force: true }))),
    );
  });
