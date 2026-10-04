// @effect-diagnostics nodeBuiltinImport:off - Exercises the standalone publisher's filesystem boundary without an Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { parseUpdateManifest } from "../lib/update-manifest.ts";
import {
  buildEnvironment,
  launchAgent,
  prunePublishedBuilds,
  releaseForTag,
  updateManifest,
  validateFeedConfig,
} from "./updates.ts";

const COMMIT = "cdbf78ca63edbd1289a81deecba28c2bcfcf73fd";

describe("Loom update publishing", () => {
  it("finds the installed build after an in-app update without a legacy marker write", async () => {
    const directory = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "loom-installed-record-"),
    );
    try {
      const builds = NodePath.join(directory, "Loom Builds");
      const app = NodePath.join(directory, "Loom.app");
      const record = releaseForTag("loom-v0.0.43-nightly.20260928.2375", COMMIT);
      await NodeFSP.mkdir(NodePath.join(builds, record.recordName), { recursive: true });
      await NodeFSP.mkdir(NodePath.join(builds, "old-build"));
      await NodeFSP.mkdir(NodePath.join(app, "Contents/Resources"), { recursive: true });
      await NodeFSP.writeFile(NodePath.join(builds, "installed"), "old-build\n");
      const embedded = NodePath.join(app, "Contents/Resources/loom-build.env");
      await NodeFSP.writeFile(embedded, `upstream=${record.version}\ncommit=${COMMIT}\n`);
      const source = await NodeFSP.readFile(new URL("./loom.sh", import.meta.url), "utf8");
      const functionSource = /^installed_record\(\) \{[\s\S]*?^\}/m.exec(source)?.[0];
      expect(functionSource).toBeDefined();
      const readInstalled = () =>
        NodeChildProcess.execFileSync("/bin/bash", ["-c", `${functionSource}\ninstalled_record`], {
          env: { APP_PATH: app, BUILDS_DIR: builds, PATH: "/usr/bin:/bin" },
          encoding: "utf8",
        }).trim();
      expect(readInstalled()).toBe(NodePath.join(builds, record.recordName));
      await NodeFSP.rm(embedded);
      expect(readInstalled()).toBe(NodePath.join(builds, "old-build"));
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });
  it("retains three published builds, the installed build and unrelated records", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-build-prune-"));
    try {
      for (let day = 1; day <= 5; day++) {
        const record = NodePath.join(directory, `build-${day}`);
        await NodeFSP.mkdir(NodePath.join(record, "updates"), { recursive: true });
        await NodeFSP.writeFile(NodePath.join(record, "updates/ready"), COMMIT);
        await NodeFSP.writeFile(
          NodePath.join(record, "build.env"),
          `built=2026-09-0${day}T00:00:00Z\n`,
        );
      }
      await NodeFSP.mkdir(NodePath.join(directory, "before-loom"));
      await prunePublishedBuilds(directory, "build-1");
      expect((await NodeFSP.readdir(directory)).sort()).toEqual([
        "before-loom",
        "build-1",
        "build-3",
        "build-4",
        "build-5",
      ]);
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });
  it("keeps the upstream app version while using a distinct semver release tag", () => {
    const release = releaseForTag("loom-v0.0.43-nightly.20260928.2375", COMMIT);
    expect(release.version).toBe("0.0.43-nightly.20260928.2375");
    expect(release.releaseTag).toBe("0.0.43-nightly.20260928.2375");
    expect(release.releaseTag).not.toMatch(/^v/);
    expect(encodeURIComponent(release.releaseTag)).toBe(release.releaseTag);
    expect(release.channel).toBe("nightly");
    expect(releaseForTag("loom-v0.0.43", COMMIT).channel).toBe("latest");
  });

  it.each([
    "v0.0.43",
    "loom-v0.0.43-preview.20260928.1",
    "loom-v0.0.43\nanything",
    "loom-v1;echo nope",
  ])("rejects unapproved integration tag %s", (tag) => {
    expect(() => releaseForTag(tag, COMMIT)).toThrow("Invalid Loom integration");
  });

  it("rejects a mutable branch name as the release source", () => {
    expect(() => releaseForTag("loom-v0.0.43", "main")).toThrow("Invalid Loom integration");
  });

  it("refuses upstream, missing and mock update feeds", () => {
    expect(() =>
      validateFeedConfig("provider: github\nowner: kylebegeman\nrepo: loom\nchannel: nightly\n"),
    ).not.toThrow();
    for (const raw of [
      "",
      "provider: github\nowner: pingdotgg\nrepo: t3code",
      "provider: generic\nurl: http://localhost:3000",
      "provider: generic\nowner: kylebegeman\nrepo: loom",
    ]) {
      expect(() => validateFeedConfig(raw)).toThrow("kylebegeman/loom update feed");
    }
  });

  it("builds with the Loom feed and removes inherited Electron and build overrides", () => {
    const env = buildEnvironment("/tmp/loom-build", {
      ELECTRON_RUN_AS_NODE: "1",
      T3CODE_DESKTOP_UPDATE_REPOSITORY: "pingdotgg/t3code",
      T3CODE_DESKTOP_MOCK_UPDATES: "true",
      T3CODE_DESKTOP_SKIP_BUILD: "true",
      VITE_HTTP_URL: "http://localhost:3000",
      VITE_WS_URL: "ws://localhost:3000",
    });
    expect(env.T3CODE_DESKTOP_UPDATE_REPOSITORY).toBe("kylebegeman/loom");
    expect(env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    expect(env).not.toHaveProperty("T3CODE_DESKTOP_MOCK_UPDATES");
    expect(env).not.toHaveProperty("T3CODE_DESKTOP_SKIP_BUILD");
    expect(env).not.toHaveProperty("VITE_HTTP_URL");
    expect(env).not.toHaveProperty("VITE_WS_URL");
  });

  it("hashes the final signed ZIP and writes metadata the updater can read", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-update-test-"));
    try {
      const release = releaseForTag("loom-v0.0.43-nightly.20260928.2375", COMMIT);
      const zip = NodePath.join(directory, release.filename);
      const contents = Buffer.from("final signed archive, after signing changed the bundle");
      await NodeFSP.writeFile(zip, contents);
      const parsed = parseUpdateManifest(
        await updateManifest(zip, release),
        "nightly-mac.yml",
        "macOS",
      );
      expect(parsed.version).toBe(release.version);
      expect(parsed.files).toEqual([
        {
          url: release.filename,
          size: contents.length,
          sha512: NodeCrypto.createHash("sha512").update(contents).digest("base64"),
        },
      ]);
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps paths with spaces and XML characters as separate launchd arguments", () => {
    const plist = launchAgent(
      "/Users/Kyle & Co/node",
      "/Users/Kyle & Co/Loom Updates/updates.ts",
      "/tmp/Loom <updates>.log",
    );
    expect(plist).toContain("<string>/Users/Kyle &amp; Co/node</string>");
    expect(plist).toContain("<string>/Users/Kyle &amp; Co/Loom Updates/updates.ts</string>");
    expect(plist).toContain("<string>/tmp/Loom &lt;updates&gt;.log</string>");
  });
});
