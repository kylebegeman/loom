import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId } from "@t3tools/contracts";
import { LIBRARY_TOOL_IDS, type LibraryToolId } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { describe, expect } from "vite-plus/test";
import * as ProcessRunner from "../../processRunner.ts";
import {
  compareVersions,
  judgeToolCheck,
  makeProfileReadinessReader,
  parseToolVersion,
  TOOL_PROBES,
} from "./LibraryProfileReadiness.ts";

/** Real output of each catalog check, with the version it should read. */
const SAMPLES: Record<LibraryToolId, { readonly output: string; readonly version: string }> = {
  git: { output: "git version 2.46.0 (Apple Git-154)\n", version: "2.46.0" },
  node: { output: "v24.3.0\n", version: "24.3.0" },
  pnpm: { output: "11.10.0\n", version: "11.10.0" },
  npm: { output: "11.4.2\n", version: "11.4.2" },
  yarn: { output: "1.22.22\n", version: "1.22.22" },
  bun: { output: "1.2.18\n", version: "1.2.18" },
  deno: {
    output: "deno 2.4.0 (stable, release, aarch64-apple-darwin)\nv8 13.7.152.6\ntypescript 5.8.3\n",
    version: "2.4.0",
  },
  python: { output: "Python 3.13.5\n", version: "3.13.5" },
  uv: { output: "uv 0.7.19 (38ee6ec80 2025-07-02)\n", version: "0.7.19" },
  xcode: { output: "Xcode 26.0\nBuild version 17A324\n", version: "26.0" },
  swift: {
    output:
      "swift-driver version: 1.127.14.1 Apple Swift version 6.2 (swiftlang-6.2.0.19.9 clang-1700.3.19.1)\nTarget: arm64-apple-macosx26.0\n",
    version: "6.2",
  },
  rust: { output: "rustc 1.88.0 (6b00bc388 2025-06-23)\n", version: "1.88.0" },
  go: { output: "go version go1.24.4 darwin/arm64\n", version: "1.24.4" },
  java: {
    output:
      '\nopenjdk version "21.0.7" 2025-04-15 LTS\nOpenJDK Runtime Environment Temurin-21.0.7+6 (build 21.0.7+6-LTS)\n',
    version: "21.0.7",
  },
  docker: { output: "Docker version 28.3.0, build 38b7060\n", version: "28.3.0" },
  openscad: { output: "\nOpenSCAD version 2021.01\n", version: "2021.01" },
  kicad: { output: "9.0.3\n", version: "9.0.3" },
};

describe("catalog checks", () => {
  it("has a check and a sample for every catalog tool", () => {
    expect(Object.keys(TOOL_PROBES).toSorted()).toEqual([...LIBRARY_TOOL_IDS].toSorted());
  });

  describe.each(LIBRARY_TOOL_IDS)("%s", (id) => {
    const sample = SAMPLES[id];
    it("reads the version", () => {
      expect(parseToolVersion(id, sample.output)).toBe(sample.version);
      expect(
        judgeToolCheck(
          { id, minimumVersion: sample.version },
          {
            kind: "ran",
            code: 0,
            output: sample.output,
          },
        ),
      ).toMatchObject({ id, status: "ok", version: sample.version });
    });

    it("reports outdated with the version found", () => {
      expect(
        judgeToolCheck(
          { id, minimumVersion: "99999" },
          {
            kind: "ran",
            code: 0,
            output: sample.output,
          },
        ),
      ).toMatchObject({ status: "outdated", version: sample.version, minimumVersion: "99999" });
    });

    it("reports missing when the command is not found", () => {
      expect(judgeToolCheck({ id }, { kind: "not-found" })).toMatchObject({
        status: "missing",
      });
    });

    it("reports unknown when the check fails or its output cannot be read", () => {
      expect(judgeToolCheck({ id }, { kind: "failed" }).status).toBe("unknown");
      expect(judgeToolCheck({ id }, { kind: "ran", code: 0, output: "garbage" }).status).toBe(
        "unknown",
      );
      expect(judgeToolCheck({ id }, { kind: "ran", code: 1, output: sample.output }).status).toBe(
        "unknown",
      );
    });
  });

  it("reads Java 8's old version scheme as 8", () => {
    expect(parseToolVersion("java", 'java version "1.8.0_402"\n')).toBe("8.0");
    expect(
      judgeToolCheck(
        { id: "java", minimumVersion: "17" },
        {
          kind: "ran",
          code: 0,
          output: 'java version "1.8.0_402"\n',
        },
      ),
    ).toMatchObject({ status: "outdated", version: "8.0" });
  });

  it("treats a macOS stub that answers without the tool as missing", () => {
    expect(
      judgeToolCheck(
        { id: "xcode" },
        {
          kind: "ran",
          code: 1,
          output:
            "xcode-select: error: tool 'xcodebuild' requires Xcode, but active developer directory '/Library/Developer/CommandLineTools' is a command line tools instance\n",
        },
      ).status,
    ).toBe("missing");
    expect(
      judgeToolCheck(
        { id: "java" },
        {
          kind: "ran",
          code: 1,
          output: "The operation couldn't be completed. Unable to locate a Java Runtime.\n",
        },
      ).status,
    ).toBe("missing");
  });

  it("reports a tool outside this computer's catalog as unknown", () => {
    expect(judgeToolCheck({ id: "zig" }, { kind: "ran", code: 0, output: "0.14.1" })).toEqual({
      id: "zig",
      label: "zig",
      status: "unknown",
    });
  });

  it("compares versions part by part", () => {
    expect(compareVersions("24.3.0", "24")).toBeGreaterThan(0);
    expect(compareVersions("24", "24.0.0")).toBe(0);
    expect(compareVersions("9.10", "9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.18", "1.3")).toBeLessThan(0);
  });
});

describe("makeProfileReadinessReader", () => {
  it.effect("runs each required tool's check and lists secret names", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const bin = yield* fs.makeTempDirectoryScoped({ prefix: "loom-readiness-" });
      const tool = (name: string, script: string) =>
        fs
          .writeFileString(path.join(bin, name), `#!/bin/sh\n${script}\n`)
          .pipe(Effect.andThen(fs.chmod(path.join(bin, name), 0o755)));
      yield* tool("node", "echo v20.11.1");
      yield* tool("go", "echo 'go version go1.24.4 linux/amd64'");
      yield* tool("uv", "echo 'something went wrong' >&2; exit 2");

      const read = yield* makeProfileReadinessReader;
      const readiness = yield* read({
        projectId: "project-1",
        environmentId: EnvironmentId.make("environment-1"),
        profile: {
          requiredTools: [
            { id: "node", minimumVersion: "24" },
            { id: "go" },
            { id: "uv" },
            { id: "docker" },
          ],
          secretNames: ["OPENAI_API_KEY"],
        },
      }).pipe(
        Effect.provideService(HostProcess.Environment, { PATH: bin }),
        Effect.provideService(HostProcess.Platform, "linux"),
      );

      expect(readiness.checks).toEqual([
        {
          id: "node",
          label: "Node.js",
          status: "outdated",
          minimumVersion: "24",
          version: "20.11.1",
        },
        { id: "go", label: "Go", status: "ok", version: "1.24.4" },
        { id: "uv", label: "uv", status: "unknown" },
        { id: "docker", label: "Docker", status: "missing" },
      ]);
      expect(readiness.secrets).toEqual([{ name: "OPENAI_API_KEY" }]);
      expect(readiness.environmentId).toBe("environment-1");
    }).pipe(
      Effect.scoped,
      Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer))),
    ),
  );
});
