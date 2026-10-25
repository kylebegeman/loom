// @effect-diagnostics nodeBuiltinImport:off - Exercises the standalone publisher with a mocked GitHub CLI.
import * as NodeChildProcess from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ensureRuntimeReleaseAssets,
  runtimeReleaseAssets,
  runtimeReleaseComplete,
  validateRuntimeRelease,
} from "./runtime-release.ts";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
const version = "0.0.49-nightly.20261013.3046";
const sourceSha = "a".repeat(40);
const workflowRef = "loom-v0.0.49-nightly.20261013.3046";
const spawn = vi.mocked(NodeChildProcess.spawnSync);
afterEach(() => vi.resetAllMocks());

function githubFixture(input: {
  complete?: boolean;
  published?: boolean;
  prior?: { headSha?: string; version?: string; conclusion?: string | null };
}) {
  let complete = input.complete === true;
  let lists = 0;
  const commands: string[][] = [];
  const previous = input.prior
    ? {
        databaseId: 42,
        displayTitle: `Loom runtimes ${input.prior.version ?? version} prior-request`,
        headSha: input.prior.headSha ?? sourceSha,
        status: input.prior.conclusion ? "completed" : "in_progress",
        conclusion: input.prior.conclusion ?? null,
      }
    : null;
  let dispatched: typeof previous = null;
  spawn.mockImplementation((_command, rawArgs) => {
    const args = [...rawArgs!] as string[];
    commands.push(args);
    let stdout = "";
    if (args[0] === "release" && args[1] === "view") {
      stdout = JSON.stringify({
        isDraft: !input.published,
        assets: complete ? runtimeReleaseAssets(version).map((name) => ({ name })) : [],
      });
    } else if (args[0] === "workflow" && args[1] === "run") {
      const request = args
        .find((arg) => arg.startsWith("request_id="))!
        .slice("request_id=".length);
      dispatched = {
        databaseId: 99,
        displayTitle: `Loom runtimes ${version} ${request}`,
        headSha: sourceSha,
        status: "in_progress",
        conclusion: null,
      };
    } else if (args[0] === "run" && args[1] === "list") {
      lists++;
      const runs = previous ? [previous] : [];
      if (lists > 1) {
        const run = dispatched ?? previous!;
        complete = true;
        stdout = JSON.stringify([{ ...run, status: "completed", conclusion: "success" }]);
      } else stdout = JSON.stringify(runs);
    } else throw new Error(`Unexpected fixture GitHub command: ${args.join(" ")}`);
    return { pid: 1, output: [null, stdout, ""], stdout, stderr: "", status: 0, signal: null };
  });
  return commands;
}

describe("runtime release publication gate", () => {
  it("requires an exact publication version and commit", () => {
    expect(validateRuntimeRelease(version, sourceSha)).toEqual({ version, sourceSha });
    for (const invalid of [
      "latest",
      `v${version}`,
      `loom-v${version}`,
      "../tag",
      `${version}\nother`,
      `${version}\n`,
    ])
      expect(() => validateRuntimeRelease(invalid, sourceSha)).toThrow();
    expect(() => validateRuntimeRelease(version, "main")).toThrow();
    expect(() => validateRuntimeRelease(version, `${sourceSha}\n`)).toThrow();
  });
  it("requires every supported computer runtime and the checksum manifest", () => {
    const assets = runtimeReleaseAssets(version);
    expect(runtimeReleaseComplete(version, assets)).toBe(true);
    for (const missing of assets)
      expect(
        runtimeReleaseComplete(
          version,
          assets.filter((asset) => asset !== missing),
        ),
      ).toBe(false);
    expect(runtimeReleaseComplete("0.0.50", assets)).toBe(false);
  });
  it("does not dispatch or poll when all archives are already attached", async () => {
    const commands = githubFixture({ complete: true });
    await ensureRuntimeReleaseAssets({ version, sourceSha, workflowRef, env: {} });
    expect(commands.map((args) => args.slice(0, 2))).toEqual([["release", "view"]]);
  });
  it("refuses to repair archives on an already published release", async () => {
    const commands = githubFixture({ published: true });
    await expect(
      ensureRuntimeReleaseAssets({ version, sourceSha, workflowRef, env: {} }),
    ).rejects.toThrow("refusing to rewrite");
    expect(commands.some((args) => args[0] === "workflow")).toBe(false);
  });
  it("resumes an exact-source running build after the publisher restarts", async () => {
    const commands = githubFixture({ prior: {} });
    await ensureRuntimeReleaseAssets({ version, sourceSha, workflowRef, env: {} });
    expect(commands.some((args) => args[0] === "workflow")).toBe(false);
    expect(commands.filter((args) => args[0] === "release")).toHaveLength(2);
  });
  it.each([{ headSha: "b".repeat(40) }, { version: "0.0.50" }, { conclusion: "failure" }])(
    "does not reuse a different source, version or failed build: %j",
    async (prior) => {
      const commands = githubFixture({ prior });
      await ensureRuntimeReleaseAssets({
        version,
        sourceSha,
        workflowRef,
        env: { T3CODE_RELAY_URL: "https://relay.example.test" },
      });
      const dispatches = commands.filter((args) => args[0] === "workflow");
      expect(dispatches).toHaveLength(1);
      expect(dispatches[0]).toContain(`source_sha=${sourceSha}`);
      // The draft's version tag does not exist yet, so the build runs from the integration tag.
      expect(dispatches[0]?.[dispatches[0].indexOf("--ref") + 1]).toBe(workflowRef);
      expect(dispatches[0]).toContain("relay_url=https://relay.example.test");
    },
  );
  it.each([
    ["keeps", {}, false],
    ["retires", { LOOM_CONNECT_RETIRED: "1" }, true],
  ] as const)(
    "asks for retired runtimes only when the publisher %s Connect",
    async (_, env, retired) => {
      const commands = githubFixture({});
      await ensureRuntimeReleaseAssets({ version, sourceSha, workflowRef, env });
      const dispatch = commands.find((args) => args[0] === "workflow");
      expect(dispatch?.includes("connect_retired=1")).toBe(retired);
    },
  );
});
