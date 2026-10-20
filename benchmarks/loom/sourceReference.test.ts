// Git/source fixtures stay isolated from the checkout and benchmark data.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import {
  BENCHMARK_SOURCES,
  currentSourceDigests,
  resolveSourceReference,
  sourceReferencePlugin,
} from "./sourceReference.ts";

const roots: string[] = [];
const dependencies = [
  "apps/server/src/dependency.ts",
  "apps/web/src/dependency.ts",
  "packages/shared/src/dependency.ts",
];
const oldSource = "export const version = 'baseline';\n";
const newSource = "export const version = 'optimized';\n";
const digest = (source: string) => NodeCrypto.createHash("sha256").update(source).digest("hex");

function fixture() {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-source-reference-")),
  );
  roots.push(root);
  const git = (...args: string[]) =>
    NodeChildProcess.execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const write = (path: string, code: string) => {
    const file = NodePath.join(root, path);
    NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
    NodeFS.writeFileSync(file, code);
  };
  git("init", "--quiet");
  for (const path of [...BENCHMARK_SOURCES, ...dependencies]) write(path, oldSource);
  git("add", ".");
  git(
    "-c",
    "user.name=Benchmark fixture",
    "-c",
    "user.email=benchmark@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "baseline",
  );
  const revision = git("rev-parse", "HEAD");
  for (const path of BENCHMARK_SOURCES) write(path, newSource);
  return { root, revision, git, write };
}

afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

it("replays exact committed source and hashes without changing current files", () => {
  const f = fixture();
  const reference = resolveSourceReference(f.root, "HEAD");
  expect(reference.revision).toBe(f.revision);
  expect(reference.sources.size).toBe(BENCHMARK_SOURCES.length);
  for (const path of BENCHMARK_SOURCES) {
    expect(reference.sources.get(NodeFS.realpathSync(NodePath.join(f.root, path)))).toEqual({
      path,
      code: oldSource,
      sha256: digest(oldSource),
    });
    expect(reference.digests[path]).toBe(digest(oldSource));
  }
  expect(currentSourceDigests(f.root)).toEqual(
    Object.fromEntries(BENCHMARK_SOURCES.map((path) => [path, digest(newSource)])),
  );
});

it.each(dependencies)("rejects changed shared runtime dependency %s", (path) => {
  const f = fixture();
  f.write(path, newSource);
  f.git("add", path);
  expect(() => resolveSourceReference(f.root, f.revision)).toThrow(path);
});

it("rejects untracked runtime dependencies and deleted dependencies", () => {
  const f = fixture();
  const untracked = "packages/shared/src/new-runtime.ts";
  f.write(untracked, oldSource);
  expect(() => resolveSourceReference(f.root, f.revision)).toThrow(untracked);
  NodeFS.unlinkSync(NodePath.join(f.root, untracked));
  NodeFS.unlinkSync(NodePath.join(f.root, dependencies[0]!));
  expect(() => resolveSourceReference(f.root, f.revision)).toThrow(dependencies[0]);
});

it("allows changed and newly added tests while preserving dependency checks", () => {
  const f = fixture();
  f.write("packages/shared/src/dependency.test.ts", newSource);
  f.write("apps/web/src/dependency.test.tsx", newSource);
  f.git("add", "packages/shared/src/dependency.test.ts");
  expect(resolveSourceReference(f.root, f.revision).revision).toBe(f.revision);
});

it.each(["missing-reference", "--help"])("rejects invalid reference %s", (ref) => {
  const f = fixture();
  expect(() => resolveSourceReference(f.root, ref)).toThrow();
});

it("audits only modules actually replayed and accepts Vite query suffixes", async () => {
  const f = fixture();
  const output = NodePath.join(f.root, "audit.json");
  NodeFS.writeFileSync(output, "stale evidence");
  const plugin = sourceReferencePlugin(f.root, f.revision, output);
  const load = plugin.load;
  if (typeof load !== "function") throw new Error("Reference plugin must have a load hook");
  const readAudit = () => JSON.parse(NodeFS.readFileSync(output, "utf8"));
  expect(plugin.enforce).toBe("pre");
  expect(readAudit()).toEqual({ revision: f.revision, digests: {} });
  // The hook does not use its Vite context; Reflect supplies the normal receiver.
  const invoke = (path: string) => Reflect.apply(load, {}, [path]);
  expect(await invoke(NodePath.join(f.root, dependencies[0]!))).toBeNull();
  expect(readAudit().digests).toEqual({});
  expect(await invoke(`${NodePath.join(f.root, BENCHMARK_SOURCES[0])}?v=fixture`)).toBe(oldSource);
  expect(readAudit()).toEqual({
    revision: f.revision,
    digests: { [BENCHMARK_SOURCES[0]]: digest(oldSource) },
  });
  for (const path of BENCHMARK_SOURCES.slice(1))
    expect(await invoke(NodePath.join(f.root, path))).toBe(oldSource);
  expect(readAudit()).toEqual({
    revision: f.revision,
    digests: resolveSourceReference(f.root, f.revision).digests,
  });
  expect(currentSourceDigests(f.root)[BENCHMARK_SOURCES[0]]).toBe(digest(newSource));
});

it("requires an audit destination for source replay", () => {
  expect(() => sourceReferencePlugin("unused", "HEAD", undefined)).toThrow(
    "LOOM_PERF_REFERENCE_AUDIT_OUTPUT is required",
  );
});
