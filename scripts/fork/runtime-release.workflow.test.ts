// @effect-diagnostics nodeBuiltinImport:off - Executes the release workflow's shell against disposable archives and a fake GitHub CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { parseChecksums } from "@t3tools/shared/cliRelease";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { runtimeReleaseAssets } from "./runtime-release.ts";

const version = "0.0.49-nightly.20261013.3046";

it.skipIf(HostProcess.Platform.defaultValue() === "win32")(
  "workflow manifests use the same archive keys the runtime installer verifies",
  async () => {
    const workflow = await NodeFSP.readFile(
      new URL("../../.github/workflows/loom-cli-archives.yml", import.meta.url),
      "utf8",
    );
    const attach = workflow.slice(
      workflow.indexOf("      - name: Attach only to the reserved draft"),
    );
    const run = attach
      .slice(attach.indexOf("        run: |\n") + "        run: |\n".length)
      .split("\n")
      .map((line) => line.replace(/^          /, ""))
      .join("\n");
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-runtime-attach-"));
    try {
      const bin = NodePath.join(directory, "bin");
      const release = NodePath.join(directory, "release-cli");
      await NodeFSP.mkdir(bin);
      await NodeFSP.mkdir(release);
      const archives = runtimeReleaseAssets(version).filter((name) => name.endsWith(".tar.gz"));
      const digests = new Map<string, string>();
      for (const name of archives) {
        const bytes = `${name} archive bytes\n`;
        await NodeFSP.writeFile(NodePath.join(release, name), bytes);
        digests.set(name, NodeCrypto.createHash("sha256").update(bytes).digest("hex"));
      }
      await NodeFSP.writeFile(
        NodePath.join(bin, "gh"),
        `#!/bin/sh\ncase "$1 $2" in\n  "release view") printf '%s' "$LOOM_FIXTURE_IS_DRAFT" ;;\n  "release upload") printf '%s\\n' "$@" > "$LOOM_FIXTURE_UPLOAD_FILE" ;;\n  *) exit 1 ;;\nesac\n`,
        { mode: 0o700 },
      );
      if (NodeChildProcess.spawnSync("which", ["sha256sum"], { stdio: "ignore" }).status !== 0)
        await NodeFSP.writeFile(
          NodePath.join(bin, "sha256sum"),
          '#!/bin/sh\nexec shasum -a 256 "$@"\n',
          { mode: 0o700 },
        );
      const env = {
        PATH: `${bin}${NodePath.delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
        LOOM_RUNTIME_VERSION: version,
        GITHUB_REPOSITORY: "kylebegeman/loom",
        LOOM_FIXTURE_IS_DRAFT: "true",
        LOOM_FIXTURE_UPLOAD_FILE: NodePath.join(directory, "uploaded.txt"),
      };
      NodeChildProcess.execFileSync("bash", ["-c", run], { cwd: directory, env, stdio: "pipe" });
      const checksums = parseChecksums(
        await NodeFSP.readFile(NodePath.join(release, "SHA256SUMS"), "utf8"),
      );
      for (const name of archives) expect(checksums.get(name)).toBe(digests.get(name));
      expect(await NodeFSP.readFile(env.LOOM_FIXTURE_UPLOAD_FILE, "utf8")).toContain("SHA256SUMS");
      await NodeFSP.rm(env.LOOM_FIXTURE_UPLOAD_FILE);
      expect(() =>
        NodeChildProcess.execFileSync("bash", ["-c", run], {
          cwd: directory,
          env: { ...env, LOOM_FIXTURE_IS_DRAFT: "false" },
          stdio: "pipe",
        }),
      ).toThrow();
      await expect(NodeFSP.stat(env.LOOM_FIXTURE_UPLOAD_FILE)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  },
);
