// Source replay and its audit run at the benchmark tooling boundary, before timing.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { Plugin } from "vite-plus";

export const BENCHMARK_SOURCES = [
  "apps/server/src/fork/code-graph/CodeGraphIndex.ts",
  "apps/server/src/fork/model-preview-3d/check/grid.ts",
  "apps/server/src/fork/pcb-preview/semantics.ts",
  "apps/server/src/fork/project-library/LibraryStore.ts",
  "apps/web/src/fork/model-preview-3d/viewer/snap.ts",
  "apps/web/src/fork/pcb-preview/drawingDiff.ts",
] as const;

const RUNTIME_ROOTS = ["apps/server/src", "apps/web/src", "packages"];
const sha256 = (code: string) => NodeCrypto.createHash("sha256").update(code).digest("hex");
const git = (root: string, args: string[]) =>
  NodeChildProcess.execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

export function currentSourceDigests(root: string): Record<string, string> {
  return Object.fromEntries(
    BENCHMARK_SOURCES.map((path) => [
      path,
      sha256(NodeFS.readFileSync(NodePath.join(root, path), "utf8")),
    ]),
  );
}

export function resolveSourceReference(root: string, ref: string) {
  const revision = git(root, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${ref}^{commit}`,
  ]).trim();
  const changed = [
    ...git(root, [
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      revision,
      "--",
      ...RUNTIME_ROOTS,
    ]).split("\0"),
    ...git(root, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...RUNTIME_ROOTS,
    ]).split("\0"),
  ].filter(Boolean);
  const allowed: ReadonlySet<string> = new Set(BENCHMARK_SOURCES);
  const incompatible = [...new Set(changed)].filter(
    (path) => !allowed.has(path) && !/\.test\.tsx?$/.test(path),
  );
  if (incompatible.length > 0)
    throw new Error(
      `Source reference has different shared runtime dependencies: ${incompatible.toSorted().join(", ")}`,
    );
  const sources = new Map(
    BENCHMARK_SOURCES.map((path) => {
      const code = git(root, ["show", `${revision}:${path}`]);
      return [
        NodeFS.realpathSync(NodePath.join(root, path)),
        { path, code, sha256: sha256(code) },
      ] as const;
    }),
  );
  return {
    revision,
    sources,
    digests: Object.fromEntries(
      [...sources.values()].map((source) => [source.path, source.sha256]),
    ),
  };
}

export function sourceReferencePlugin(
  root: string,
  ref: string,
  auditOutput: string | undefined,
): Plugin {
  if (!auditOutput)
    throw new Error("LOOM_PERF_REFERENCE_AUDIT_OUTPUT is required for source replay");
  const reference = resolveSourceReference(root, ref);
  const output = NodePath.resolve(root, auditOutput);
  const digests: Record<string, string> = {};
  const writeAudit = () =>
    NodeFS.writeFileSync(output, JSON.stringify({ revision: reference.revision, digests }) + "\n");
  NodeFS.mkdirSync(NodePath.dirname(output), { recursive: true });
  writeAudit();
  return {
    name: "loom-benchmark-source-reference",
    enforce: "pre",
    load(id) {
      const path = id.split("?", 1)[0]!;
      if (!NodePath.isAbsolute(path) || !NodeFS.existsSync(path)) return null;
      const source = reference.sources.get(NodeFS.realpathSync(path));
      if (!source) return null;
      digests[source.path] = source.sha256;
      writeAudit();
      return source.code;
    },
  };
}
