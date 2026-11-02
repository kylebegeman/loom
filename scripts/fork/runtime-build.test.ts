// @effect-diagnostics nodeBuiltinImport:off - Exercises the publisher's build/receipt boundary with disposable files and mocked compiler processes.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import { expect, it, vi } from "vite-plus/test";
import { buildRuntimeArchive } from "./runtime-build.ts";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

const version = "0.0.173-nightly.20261102.4080";
const sourceSha = "a".repeat(40);

it("only records successfully smoke-tested exact-source archives and reuses their verified bytes", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-runtime-build-"));
  try {
    const target = `${NodeProcess.platform}-${NodeProcess.arch}`;
    const outputDir = NodePath.join(directory, "runtime");
    const archive = NodePath.join(outputDir, `t3-${version}-${target}.tar.gz`);
    const receipt = NodePath.join(outputDir, `${target}.json`);
    await NodeFSP.writeFile(
      NodePath.join(directory, "package.json"),
      JSON.stringify({ engines: { node: NodeProcess.versions.node } }),
    );
    const monitor = NodePath.join(directory, "native/resource-monitor/target/release");
    await NodeFSP.mkdir(monitor, { recursive: true });
    await NodeFSP.writeFile(NodePath.join(monitor, "t3-resource-monitor"), "monitor");
    let head = "b".repeat(40);
    let dirty = "";
    let smokeFails = true;
    const commands: string[][] = [];
    vi.mocked(NodeChildProcess.spawnSync).mockImplementation((command, rawArgs) => {
      const args = rawArgs as string[];
      commands.push([String(command), ...args]);
      const stdout =
        command === "git" && args[0] === "rev-parse"
          ? head
          : command === "git" && args[0] === "status"
            ? dirty
            : "";
      const status = args[0] === "scripts/smoke-cli-archive.ts" && smokeFails ? 1 : 0;
      return { pid: 1, status, stdout, stderr: "", signal: null, output: [null, stdout, ""] };
    });
    const input = { version, sourceSha, sourceDir: directory, outputDir, env: {} };
    await expect(buildRuntimeArchive(input)).rejects.toThrow("different source");
    expect(commands.some((args) => args[1] === "install")).toBe(false);
    head = sourceSha;
    dirty = " M package.json";
    await expect(buildRuntimeArchive(input)).rejects.toThrow("clean isolated checkout");
    dirty = "";
    await NodeFSP.mkdir(outputDir);
    await NodeFSP.writeFile(archive, "built runtime");
    await expect(buildRuntimeArchive(input)).rejects.toThrow("smoke-cli-archive");
    await expect(NodeFSP.stat(receipt)).rejects.toMatchObject({ code: "ENOENT" });
    expect(commands.at(-1)?.slice(0, 3)).toEqual(["git", "restore", "--"]);
    smokeFails = false;
    const checked = await buildRuntimeArchive(input);
    expect(checked).toEqual({
      archive,
      sha256: NodeCrypto.createHash("sha256").update("built runtime").digest("hex"),
    });
    const buildCount = commands.filter((args) => args[1] === "scripts/smoke-cli-archive.ts").length;
    expect(await buildRuntimeArchive(input)).toEqual(checked);
    expect(commands.filter((args) => args[1] === "scripts/smoke-cli-archive.ts")).toHaveLength(
      buildCount,
    );
    await expect(
      buildRuntimeArchive({ ...input, env: { LOOM_CONNECT_RETIRED: "1" } }),
    ).rejects.toThrow("receipt");
    await NodeFSP.writeFile(archive, "changed runtime");
    await expect(buildRuntimeArchive(input)).rejects.toThrow("receipt");
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
