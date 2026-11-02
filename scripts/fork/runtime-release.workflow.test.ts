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
const sourceSha = "a".repeat(40);

it.skipIf(HostProcess.Platform.defaultValue() === "win32")(
  "workflow verifies local Mac archives and produces complete installer-compatible manifests",
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
      await NodeFSP.writeFile(
        NodePath.join(bin, "gh"),
        `#!/bin/sh
case "$1 $2" in
  "release view")
    case "$*" in
      *"--json isDraft"*) printf '%s' "$LOOM_FIXTURE_IS_DRAFT" ;;
      *"--json targetCommitish"*) printf '%s' "$LOOM_FIXTURE_SOURCE" ;;
      *) exit 1 ;;
    esac ;;
  "release download") cp "$LOOM_FIXTURE_MAC_SOURCE" "release-cli/t3-$LOOM_RUNTIME_VERSION-darwin-arm64.tar.gz" ;;
  "release upload") printf '%s\\n' "$@" > "$LOOM_FIXTURE_UPLOAD_FILE" ;;
  *) exit 1 ;;
esac
`,
        { mode: 0o700 },
      );
      if (NodeChildProcess.spawnSync("which", ["sha256sum"], { stdio: "ignore" }).status !== 0)
        await NodeFSP.writeFile(
          NodePath.join(bin, "sha256sum"),
          '#!/bin/sh\nexec shasum -a 256 "$@"\n',
          { mode: 0o700 },
        );
      for (const localMac of [false, true]) {
        await NodeFSP.mkdir(release);
        const archives = runtimeReleaseAssets(version).filter((name) => name.endsWith(".tar.gz"));
        const macName = `t3-${version}-darwin-arm64.tar.gz`;
        const digests = new Map<string, string>();
        const macSource = NodePath.join(directory, "mac-source.tar.gz");
        for (const name of archives) {
          const bytes = `${name} archive bytes\n`;
          await NodeFSP.writeFile(
            localMac && name === macName ? macSource : NodePath.join(release, name),
            bytes,
          );
          digests.set(name, NodeCrypto.createHash("sha256").update(bytes).digest("hex"));
        }
        const env = {
          PATH: `${bin}${NodePath.delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
          LOOM_RUNTIME_VERSION: version,
          LOOM_RUNTIME_SOURCE_SHA: sourceSha,
          LOOM_MAC_RUNTIME_SHA256: localMac ? digests.get(macName)! : "",
          GITHUB_REPOSITORY: "kylebegeman/loom",
          LOOM_FIXTURE_IS_DRAFT: "true",
          LOOM_FIXTURE_SOURCE: sourceSha,
          LOOM_FIXTURE_MAC_SOURCE: macSource,
          LOOM_FIXTURE_UPLOAD_FILE: NodePath.join(directory, "uploaded.txt"),
        };
        NodeChildProcess.execFileSync("bash", ["-c", run], { cwd: directory, env, stdio: "pipe" });
        const checksums = parseChecksums(
          await NodeFSP.readFile(NodePath.join(release, "SHA256SUMS"), "utf8"),
        );
        for (const name of archives) expect(checksums.get(name)).toBe(digests.get(name));
        expect(await NodeFSP.readFile(env.LOOM_FIXTURE_UPLOAD_FILE, "utf8")).toContain(
          "SHA256SUMS",
        );
        await NodeFSP.rm(env.LOOM_FIXTURE_UPLOAD_FILE);
        for (const invalid of [
          { LOOM_FIXTURE_IS_DRAFT: "false" },
          { LOOM_FIXTURE_SOURCE: "b".repeat(40) },
          ...(localMac
            ? [{ LOOM_MAC_RUNTIME_SHA256: "0".repeat(64) }, { LOOM_MAC_RUNTIME_SHA256: "invalid" }]
            : []),
        ]) {
          expect(
            () =>
              NodeChildProcess.execFileSync("bash", ["-c", run], {
                cwd: directory,
                env: { ...env, ...invalid },
                stdio: "pipe",
              }),
            JSON.stringify({ localMac, invalid }),
          ).toThrow();
          await expect(NodeFSP.stat(env.LOOM_FIXTURE_UPLOAD_FILE)).rejects.toMatchObject({
            code: "ENOENT",
          });
        }
        await NodeFSP.rm(NodePath.join(release, `t3-${version}-linux-x64.tar.gz`));
        expect(() =>
          NodeChildProcess.execFileSync("bash", ["-c", run], {
            cwd: directory,
            env,
            stdio: "pipe",
          }),
        ).toThrow();
        await expect(NodeFSP.stat(env.LOOM_FIXTURE_UPLOAD_FILE)).rejects.toMatchObject({
          code: "ENOENT",
        });
        await NodeFSP.rm(release, { recursive: true });
      }
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  },
);
