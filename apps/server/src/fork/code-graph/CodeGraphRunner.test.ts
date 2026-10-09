// @effect-diagnostics nodeBuiltinImport:off - Writes a stub Graphify script to a temp directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  buildArgv,
  graphifyEnvironment,
  isShrinkRefusal,
  isTestedVersion,
  parseGraphifyVersion,
  startGraphify,
  type GraphifyInvocation,
} from "./CodeGraphRunner.ts";

describe("buildArgv", () => {
  it("only ever asks Graphify for its version, an extract or an update", () => {
    const invocations: GraphifyInvocation[] = [
      { _tag: "version" },
      { _tag: "extract", root: "/repo", outDir: "/state/out", force: false },
      { _tag: "extract", root: "/repo", outDir: "/state/out", force: true },
      { _tag: "update", root: "/repo", force: false },
      { _tag: "update", root: "/repo", force: true },
    ];
    for (const invocation of invocations) {
      expect(["--version", "extract", "update"]).toContain(buildArgv(invocation)[0]);
    }
    expect(buildArgv(invocations[1]!)).toEqual([
      "extract",
      "/repo",
      "--code-only",
      "--out",
      "/state/out",
    ]);
    expect(buildArgv(invocations[2]!)).toContain("--force");
    expect(buildArgv(invocations[4]!)).toEqual(["update", "/repo", "--force"]);
  });
});

describe("graphifyEnvironment", () => {
  it("drops LLM credentials and points Graphify's output outside the repository", () => {
    const env = graphifyEnvironment(
      {
        PATH: "/usr/bin",
        HOME: "/home/kyle",
        ANTHROPIC_API_KEY: "a",
        OPENAI_API_KEY: "b",
        OPENAI_BASE_URL: "http://proxy",
        SOME_VENDOR_API_KEY: "c",
        AWS_SECRET_ACCESS_KEY: "d",
        GRAPHIFY_OUT: "graphify-out",
      },
      "/state/code-graph/p1",
    );
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/kyle",
      GRAPHIFY_OUT: "/state/code-graph/p1",
      GRAPHIFY_NO_TIPS: "1",
      PYTHONUNBUFFERED: "1",
    });
  });
});

describe("versions and output", () => {
  it("reads the version Graphify prints and compares it to the tested one", () => {
    expect(parseGraphifyVersion("graphify 0.9.83\n")).toBe("0.9.83");
    expect(parseGraphifyVersion("graphify 0.10.0rc1")).toBe("0.10.0rc1");
    expect(parseGraphifyVersion("usage: graphify")).toBeNull();
    expect(isTestedVersion("0.9.83")).toBe(true);
    expect(isTestedVersion("0.9.84")).toBe(false);
  });

  it("recognizes Graphify's refusal to shrink a graph", () => {
    expect(
      isShrinkRefusal([
        "[graphify] WARNING: new graph has 10 nodes but existing graph.json has 20 (net -10). Refusing to overwrite.",
      ]),
    ).toBe(true);
    expect(isShrinkRefusal(["Code graph updated."])).toBe(false);
  });
});

describe("startGraphify", () => {
  const stub = (script: string) => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-graphify-"));
    const file = NodePath.join(dir, "graphify.sh");
    NodeFS.writeFileSync(file, script);
    return file;
  };

  it.effect("streams lines and reports the exit code and environment", () =>
    Effect.gen(function* () {
      const file = stub('echo "args: $*"\necho "out: $GRAPHIFY_OUT"\necho "oops" >&2\nexit 3\n');
      const seen: string[] = [];
      const child = yield* startGraphify({
        command: ["/bin/sh", file],
        invocation: { _tag: "update", root: "/repo", force: false },
        env: graphifyEnvironment({ PATH: process.env.PATH }, "/state/out"),
        timeoutMs: 10_000,
        onLine: (line) => seen.push(line),
      });
      expect(yield* child.exit).toBe(3);
      expect(seen).toEqual(
        expect.arrayContaining(["args: update /repo", "out: /state/out", "oops"]),
      );
      expect(child.lines()).toHaveLength(3);
    }),
  );

  it.effect("stops a running process and reports a missing command", () =>
    Effect.gen(function* () {
      const file = stub("echo started\nsleep 30\n");
      const child = yield* startGraphify({
        command: ["/bin/sh", file],
        invocation: { _tag: "version" },
        env: { PATH: process.env.PATH },
        timeoutMs: 60_000,
      });
      yield* child.stop;
      expect(yield* child.exit).toBeNull();

      const missing = yield* startGraphify({
        command: ["/nonexistent/graphify"],
        invocation: { _tag: "version" },
        env: {},
        timeoutMs: 1_000,
      });
      expect(yield* missing.exit).toBeNull();
      expect(missing.lines()[0]).toContain("Could not start /nonexistent/graphify");
    }),
  );
});
