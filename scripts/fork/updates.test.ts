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
  iosPublishConfig,
  unlockIosSigningKeychain,
  iosSourceQualification,
  automaticIosEnvironment,
  prunePublishedBuilds,
  releaseForTag,
  releaseFromRepository,
  restoreBuildInputs,
  reservePublicationTag,
  updateManifest,
  validateFeedConfig,
} from "./updates.ts";

const COMMIT = "cdbf78ca63edbd1289a81deecba28c2bcfcf73fd";

async function publicationFixture() {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-publication-tags-"));
  const source = NodePath.join(root, "source");
  const remote = NodePath.join(root, "origin.git");
  await NodeFSP.mkdir(source);
  const executeGit = (cwd: string, args: string[]) =>
    NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const git = (...args: string[]) => executeGit(source, args);
  executeGit(root, ["init", "--quiet", "--bare", remote]);
  git("init", "--quiet");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("remote", "add", "origin", remote);
  return {
    root,
    source,
    git,
    remoteGit: (...args: string[]) => executeGit(remote, args),
    commit: (message: string) => {
      git("commit", "--quiet", "--allow-empty", "-m", message);
      return git("rev-parse", "HEAD");
    },
  };
}

describe("Loom update publishing", () => {
  it("cleans generated build inputs so the next integration can check out", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-build-cleanup-"));
    const buildInputs = [
      "apps/server/package.json",
      "apps/desktop/package.json",
      "apps/web/package.json",
      "packages/contracts/package.json",
      "pnpm-lock.yaml",
      "apps/desktop/src/preview/AnnotationStyles.generated.ts",
    ];
    const git = (...args: string[]) =>
      NodeChildProcess.execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
    try {
      git("init", "--quiet");
      for (const file of [...buildInputs, "unrelated.txt"]) {
        await NodeFSP.mkdir(NodePath.dirname(NodePath.join(directory, file)), { recursive: true });
        await NodeFSP.writeFile(NodePath.join(directory, file), "original\n");
      }
      git("add", ".");
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      );
      for (const file of [...buildInputs, "unrelated.txt"]) {
        await NodeFSP.writeFile(NodePath.join(directory, file), "changed\n");
      }
      restoreBuildInputs(directory);
      for (const file of buildInputs) {
        expect(await NodeFSP.readFile(NodePath.join(directory, file), "utf8")).toBe("original\n");
      }
      expect(git("status", "--porcelain")).toBe("M unrelated.txt");
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });

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
  it("uses the initial requested version before Loom has publication history", () => {
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

  it("advances Loom's patch after an upstream integration with an older version base", () => {
    const release = releaseForTag("loom-v0.0.46-nightly.20261013.3044", COMMIT, {
      publications: [{ tag: "0.0.47-nightly.20261013.3043", commit: "a".repeat(40) }],
    });
    expect(release.version).toBe("0.0.48-nightly.20261013.3044");
    expect(release.releaseTag).toBe(release.version);
  });

  it("reuses an immutable publication for the same source and channel", () => {
    const release = releaseForTag("loom-v0.0.46-nightly.20261014.1", COMMIT, {
      publications: [{ tag: "0.0.47-nightly.20261013.3044", commit: COMMIT }],
    });
    expect(release.version).toBe("0.0.47-nightly.20261013.3044");
    expect(release.recordName).toBe(`0.0.47-nightly.20261013.3044-${COMMIT.slice(0, 10)}`);
  });

  it.each(["20261012.9000", "20261015.1"])(
    "keeps the patch monotonic despite incoming nightly date/counter %s",
    (suffix) => {
      expect(
        releaseForTag(`loom-v0.0.46-nightly.${suffix}`, COMMIT, {
          publications: [{ tag: "0.0.47-nightly.20261014.9000", commit: "a".repeat(40) }],
        }).version,
      ).toBe(`0.0.48-nightly.${suffix}`);
    },
  );

  it("keeps automatic changes within the last approved major and minor", () => {
    expect(
      releaseForTag("loom-v2.3.0-nightly.20261013.3044", COMMIT, {
        publications: [{ tag: "0.0.47-nightly.20261013.3043", commit: "a".repeat(40) }],
      }).version,
    ).toBe("0.0.48-nightly.20261013.3044");
  });

  it("accepts an explicit newer own version through the integration annotation", () => {
    expect(
      releaseForTag("loom-v1.0.0-nightly.20261013.3044", COMMIT, {
        annotation: "Loom approved major release\nloom-release=1.0.0-nightly.20261013.3044",
        publications: [{ tag: "0.0.47-nightly.20261013.3043", commit: "a".repeat(40) }],
      }).version,
    ).toBe("1.0.0-nightly.20261013.3044");
  });

  it("rejects an explicit own version that would downgrade the update feed", () => {
    expect(() =>
      releaseForTag("loom-v0.0.46-nightly.20261013.3044", COMMIT, {
        annotation: "loom-release=0.0.46-nightly.20261013.3044",
        publications: [{ tag: "0.0.47-nightly.20261013.3043", commit: "a".repeat(40) }],
      }),
    ).toThrow("newer than");
  });

  it("keeps stable and nightly publications distinct when source is promoted", () => {
    const stable = releaseForTag("loom-v0.0.46", COMMIT, {
      publications: [{ tag: "0.0.47-nightly.20261013.3044", commit: COMMIT }],
    });
    expect(stable.version).toBe("0.0.48");
    expect(stable.channel).toBe("latest");
    const nightly = releaseForTag("loom-v0.0.46-nightly.20261014.1", "b".repeat(40), {
      publications: [{ tag: stable.version, commit: COMMIT }],
    });
    expect(nightly.version).toBe("0.0.49-nightly.20261014.1");
    expect(nightly.channel).toBe("nightly");
  });

  it("keeps genuine annotated upstream provenance separate from Loom's patch", () => {
    const upstream = "v0.0.46-nightly.20261013.3042";
    const release = releaseForTag("loom-v0.0.47-nightly.20261013.3044", COMMIT, {
      annotation: `loom-release=0.0.47-nightly.20261013.3044\nupstream=${upstream}`,
      upstreamTags: [upstream],
    });
    expect(release.upstreamTag).toBe(upstream);
    expect(() =>
      releaseForTag("loom-v0.0.47-nightly.20261013.3044", COMMIT, {
        annotation: "upstream=v9.0.0",
        upstreamTags: [upstream],
      }),
    ).toThrow("source history");
  });

  it("uses numeric patch and nightly counters rather than lexical tag order", () => {
    const release = releaseForTag("loom-v0.0.1-nightly.20261013.1", COMMIT, {
      publications: [
        { tag: "0.0.9-nightly.20261015.9999", commit: "a".repeat(40) },
        { tag: "0.0.10-nightly.20261013.2", commit: "b".repeat(40) },
        { tag: "0.0.10-nightly.20261013.10", commit: "c".repeat(40) },
      ],
    });
    expect(release.version).toBe("0.0.11-nightly.20261013.1");
    expect(
      releaseForTag("loom-v0.0.1-nightly.20261014.1", COMMIT, {
        publications: [
          { tag: "0.0.10-nightly.20261013.2", commit: COMMIT },
          { tag: "0.0.10-nightly.20261013.10", commit: COMMIT },
        ],
      }).version,
    ).toBe("0.0.10-nightly.20261013.10");
  });

  it("reserves source/version identity before publication and reuses it on retry", async () => {
    const fixture = await publicationFixture();
    try {
      const first = fixture.commit("first");
      fixture.git("tag", "v0.0.46-nightly.20261013.3042", first);
      fixture.git("tag", "0.0.47-nightly.20261013.3043", first);
      const source = fixture.commit("new source");
      const integration = "loom-v0.0.46-nightly.20261013.3044";
      fixture.git(
        "tag",
        "-a",
        integration,
        "-m",
        "Loom built from upstream v0.0.46-nightly.20261013.3042",
        source,
      );
      const release = releaseFromRepository(fixture.source, integration);
      expect(release.version).toBe("0.0.48-nightly.20261013.3044");
      expect(release.upstreamTag).toBe("v0.0.46-nightly.20261013.3042");
      reservePublicationTag(release, fixture.source);
      expect(fixture.remoteGit("rev-parse", `${release.releaseTag}^{commit}`)).toBe(source);
      const retryTag = "loom-v0.0.46-nightly.20261014.1";
      fixture.git("tag", "-a", retryTag, "-m", "upstream=v0.0.46-nightly.20261013.3042", source);
      const retry = releaseFromRepository(fixture.source, retryTag);
      expect(retry.recordName).toBe(release.recordName);
      reservePublicationTag(retry, fixture.source);
      expect(fixture.remoteGit("tag", "--list")).toBe(release.releaseTag);
    } finally {
      await NodeFSP.rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("never overwrites a remote reservation won by another source", async () => {
    const fixture = await publicationFixture();
    try {
      const other = fixture.commit("other source");
      const source = fixture.commit("selected source");
      const release = releaseForTag("loom-v0.0.48-nightly.20261013.3044", source);
      fixture.git("push", "--quiet", "origin", `${other}:refs/tags/${release.releaseTag}`);
      expect(() => reservePublicationTag(release, fixture.source)).toThrow();
      expect(fixture.git("tag", "--list", release.releaseTag)).toBe("");
      expect(fixture.remoteGit("rev-parse", `${release.releaseTag}^{commit}`)).toBe(other);
      fixture.git(
        "fetch",
        "--quiet",
        "origin",
        `refs/tags/${release.releaseTag}:refs/tags/${release.releaseTag}`,
      );
      expect(() => reservePublicationTag(release, fixture.source)).toThrow("different source");
      expect(fixture.git("rev-parse", `${release.releaseTag}^{commit}`)).toBe(other);
    } finally {
      await NodeFSP.rm(fixture.root, { recursive: true, force: true });
    }
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

describe("optional Loom iOS delivery", () => {
  const ownConfig = {
    enabled: true,
    teamId: "23W93ZUURR",
    appId: "1234567890",
    profile: "loom-personal",
    groups: ["Personal testing"],
  };

  it("keeps desktop publishing independent until iOS delivery is enabled", () => {
    expect(iosPublishConfig({ enabled: false })).toBeNull();
    expect(() => iosPublishConfig({ ...ownConfig, enabled: undefined })).toThrow(
      "explicit enabled",
    );
    expect(iosPublishConfig(ownConfig)).toMatchObject({
      profile: "loom-personal",
      groups: ["Personal testing"],
    });
  });

  it("requires both absolute paths for a dedicated signing keychain", () => {
    const signing = {
      signingKeychain: "/private/loom.keychain-db",
      signingKeychainPasswordFile: "/private/keychain-password",
    };
    expect(iosPublishConfig({ ...ownConfig, ...signing })).toMatchObject(signing);
    expect(() =>
      iosPublishConfig({ ...ownConfig, signingKeychain: signing.signingKeychain }),
    ).toThrow("paired absolute paths");
    expect(() =>
      iosPublishConfig({
        ...ownConfig,
        signingKeychainPasswordFile: signing.signingKeychainPasswordFile,
      }),
    ).toThrow("paired absolute paths");
    expect(() =>
      iosPublishConfig({ ...ownConfig, ...signing, signingKeychain: "relative" }),
    ).toThrow("paired absolute paths");
  });

  it("rejects exposed or symlinked keychain password files before accessing a keychain", async () => {
    const directory = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "loom-keychain-password-"),
    );
    const passwordFile = NodePath.join(directory, "password");
    const link = NodePath.join(directory, "password-link");
    try {
      await NodeFSP.writeFile(passwordFile, "test-only-password", { mode: 0o644 });
      expect(() => unlockIosSigningKeychain("/nonexistent.keychain-db", passwordFile)).toThrow(
        "private file",
      );
      await NodeFSP.chmod(passwordFile, 0o600);
      await NodeFSP.symlink(passwordFile, link);
      expect(() => unlockIosSigningKeychain("/nonexistent.keychain-db", link)).toThrow();
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects upstream app/team targets before local automatic delivery", () => {
    expect(() => iosPublishConfig({ ...ownConfig, appId: "6787819824" })).toThrow(
      "your own App Store Connect app",
    );
    expect(() => iosPublishConfig({ ...ownConfig, teamId: "ARK85ZXQ4Z" })).toThrow(
      "your own Apple team",
    );
  });

  it("rejects ambiguous credential and export/group configuration", () => {
    expect(() => iosPublishConfig({ ...ownConfig, profile: "" })).toThrow("named asc");
    expect(() => iosPublishConfig({ ...ownConfig, exportOptions: "relative.plist" })).toThrow(
      "absolute plist",
    );
    expect(() => iosPublishConfig({ ...ownConfig, groups: ["Internal,External"] })).toThrow(
      "groups",
    );
    expect(() => iosPublishConfig({ ...ownConfig, groups: ["Internal\nExternal"] })).toThrow(
      "groups",
    );
  });
});

it("waits for the latest successful iOS verification of the exact published commit", () => {
  const run = {
    headSha: COMMIT,
    path: ".github/workflows/loom-ios-testflight.yml",
    status: "completed",
    conclusion: "success",
    databaseId: 1,
  };
  expect(iosSourceQualification([], COMMIT)).toBe("pending");
  expect(iosSourceQualification([run], COMMIT)).toBe("qualified");
  expect(iosSourceQualification([{ ...run, headSha: "f".repeat(40) }], COMMIT)).toBe("pending");
  expect(iosSourceQualification([{ ...run, path: ".github/workflows/release.yml" }], COMMIT)).toBe(
    "pending",
  );
  expect(
    iosSourceQualification(
      [run, { ...run, databaseId: 2, status: "in_progress", conclusion: null }],
      COMMIT,
    ),
  ).toBe("pending");
  expect(
    iosSourceQualification([run, { ...run, databaseId: 2, conclusion: "failure" }], COMMIT),
  ).toBe("pending");
});

it("does not inherit interactive build or export overrides into automatic iOS delivery", () => {
  const env = {
    LOOM_IOS_BUILD_NUMBER: "1",
    LOOM_IOS_SOURCE_SHA: COMMIT,
    LOOM_IOS_EXPORT_OPTIONS: "/stale.plist",
    ASC_PROFILE: "some-profile",
    PATH: "/usr/bin",
  };
  expect(automaticIosEnvironment(env)).toEqual({ ASC_PROFILE: "some-profile", PATH: "/usr/bin" });
  expect(env.LOOM_IOS_BUILD_NUMBER).toBe("1");
});
