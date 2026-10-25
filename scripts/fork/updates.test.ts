// @effect-diagnostics nodeBuiltinImport:off - Exercises the standalone publisher's filesystem boundary without an Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it, vi } from "vite-plus/test";

import { parseLoomConnectConfig } from "./connect-config.ts";

import { normalizeDesktopUpdateReleaseNotes } from "../../apps/desktop/src/updates/releaseNotes.ts";
import { parseUpdateManifest } from "../lib/update-manifest.ts";
import {
  assertReleasePin,
  buildEnvironment,
  connectReceipt,
  describePublisherConnect,
  main,
  parseUpdateArgs,
  installedUpdateRequirement,
  preparedConnect,
  launchAgent,
  nextLoomVersion,
  iosPublishConfig,
  unlockIosSigningKeychain,
  iosSourceQualification,
  automaticIosEnvironment,
  prunePublishedBuilds,
  releaseForTag,
  releaseFromRepository,
  releaseHistory,
  releaseNotes,
  ensureUpstreamProvenance,
  restoreBuildInputs,
  reservePublicationTag,
  updateManifest,
  validateFeedConfig,
} from "./updates.ts";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: vi.fn(actual.mkdir),
    mkdtemp: vi.fn(actual.mkdtemp),
    stat: vi.fn(actual.stat),
    writeFile: vi.fn(actual.writeFile),
    rm: vi.fn(actual.rm),
  };
});
vi.mock("node:process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:process")>();
  return {
    ...actual,
    platform: "darwin",
    arch: "arm64",
    versions: { ...actual.versions, node: "24.21.0" },
  };
});

const COMMIT = "cdbf78ca63edbd1289a81deecba28c2bcfcf73fd";
const CONNECT_FILE = {
  enabled: true,
  mobileEnabled: true,
  clerkPublishableKey: "pk_live_YXV0aC5leGFtcGxlLnRlc3Qk",
  clerkJwtTemplate: "relay",
  clerkCliOAuthClientId: "public-oauth-id",
  relayUrl: "https://relay.example.test",
  accountPortalUrl: "https://accounts.example.test",
};
const CONNECT_CONFIG = parseLoomConnectConfig(CONNECT_FILE)!;
const T3_TRACING_KEYS = [
  "T3CODE_RELAY_CLIENT_OTLP_TRACES_URL",
  "T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET",
  "T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN",
  "VITE_RELAY_OTLP_TRACES_URL",
  "VITE_RELAY_OTLP_TRACES_DATASET",
  "VITE_RELAY_OTLP_TRACES_TOKEN",
  "T3CODE_MOBILE_OTLP_TRACES_URL",
  "T3CODE_MOBILE_OTLP_TRACES_DATASET",
  "T3CODE_MOBILE_OTLP_TRACES_TOKEN",
  "EXPO_PUBLIC_OTLP_TRACES_URL",
  "EXPO_PUBLIC_OTLP_TRACES_DATASET",
  "EXPO_PUBLIC_OTLP_TRACES_TOKEN",
];

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

describe("publisher CLI pins", () => {
  const tag = "loom-v0.0.48-nightly.20261013.3044";
  const version = "0.0.48-nightly.20261013.3044";
  const pinArgs = ["--expect-tag", tag, "--expect-sha", COMMIT, "--expect-version", version];

  it.each(["check", "prepare", "publish"])("accepts an optional complete pin on %s", (command) => {
    expect(parseUpdateArgs(command, [])).toEqual({ command, wait: false, expected: undefined });
    expect(parseUpdateArgs(command, ["--wait", ...pinArgs])).toEqual({
      command,
      wait: true,
      expected: { tag, commit: COMMIT, version },
    });
    const release = releaseForTag(tag, COMMIT);
    expect(assertReleasePin(release, undefined)).toBe(release);
    expect(assertReleasePin(release, { tag, commit: COMMIT, version })).toBe(release);
  });

  it.each([
    ["--wait", "--wait"],
    ["--unknown"],
    ["extra"],
    ["--expect-tag"],
    ["--expect-sha"],
    ["--expect-version"],
    ["--expect-tag", "--wait"],
    ["--expect-tag", ""],
    ["--expect-tag", tag],
    ["--expect-sha", COMMIT],
    ["--expect-version", version],
    ["--expect-tag", tag, "--expect-sha", COMMIT],
    [...pinArgs, "--expect-tag", tag],
    [...pinArgs, "--expect-sha", COMMIT],
    [...pinArgs, "--expect-version", version],
    ["--expect-tag=" + tag, "--expect-sha=" + COMMIT, "--expect-version=" + version],
  ])("rejects incomplete or ambiguous publication arguments %j", (...args) => {
    expect(() => parseUpdateArgs("publish", args)).toThrow("Usage:");
  });

  it.each([
    ["--expect-tag", "main"],
    ["--expect-tag", "loom-v01.0.0"],
    ["--expect-tag", tag + "\n"],
    ["--expect-sha", "main"],
    ["--expect-sha", COMMIT.slice(0, 12)],
    ["--expect-sha", COMMIT.toUpperCase()],
    ["--expect-sha", COMMIT + "\n"],
    ["--expect-version", "v" + version],
    ["--expect-version", "latest"],
    ["--expect-version", version + "\n"],
  ])("rejects invalid %s values", (flag, value) => {
    const args = [...pinArgs];
    args[args.indexOf(flag) + 1] = value;
    expect(() => parseUpdateArgs("publish", args)).toThrow("Usage:");
  });

  it("rejects extra arguments on commands that cannot use a publication pin", () => {
    for (const command of ["enable", "disable", "status", "next-version"]) {
      expect(() => parseUpdateArgs(command, pinArgs)).toThrow("Usage:");
    }
    expect(() => parseUpdateArgs(undefined, [])).toThrow("Usage:");
    expect(() => parseUpdateArgs("unknown", [])).toThrow("Usage:");
    expect(() => parseUpdateArgs("next-version", ["v0.0.46", "v0.0.47"])).toThrow("Usage:");
    expect(parseUpdateArgs("next-version", ["v0.0.46"])).toEqual({
      command: "next-version",
      upstreamTag: "v0.0.46",
    });
  });

  it.each([
    ["tag", "loom-v0.0.49-nightly.20261013.3044"],
    ["commit", "a".repeat(40)],
    ["version", "0.0.49-nightly.20261013.3044"],
  ] as const)(
    "rejects a selected %s mismatch before release queries, reservation or build",
    async (field, value) => {
      const stats = await NodeFSP.stat(import.meta.filename);
      const expected = { tag, commit: COMMIT, version, [field]: value };
      vi.resetAllMocks();
      const spawn = vi.mocked(NodeChildProcess.spawnSync).mockImplementation((command, rawArgs) => {
        const args = [...rawArgs!];
        let stdout = "";
        if (command !== "git") throw new Error(`Unexpected publication side effect: ${command}`);
        if (args[0] === "remote") stdout = "https://github.com/kylebegeman/loom.git";
        else if (args[0] === "fetch") stdout = "";
        else if (args[0] === "for-each-ref")
          stdout = args.at(-1) === "refs/tags/loom-v*" ? tag : "";
        else if (args[0] === "rev-parse") stdout = COMMIT;
        else if (args[0] === "cat-file") stdout = "commit";
        else if (args[0] !== "tag" || args[1] !== "--list") {
          throw new Error(`Unexpected Git mutation: ${args.join(" ")}`);
        }
        return { pid: 1, output: [null, stdout, ""], stdout, stderr: "", status: 0, signal: null };
      });
      try {
        vi.mocked(NodeFS.existsSync).mockReturnValue(false);
        vi.mocked(NodeFSP.mkdir).mockResolvedValue(undefined);
        vi.mocked(NodeFSP.stat).mockResolvedValue(stats);
        vi.mocked(NodeFSP.writeFile).mockResolvedValue();
        vi.mocked(NodeFSP.rm).mockResolvedValue();
        await expect(
          main("publish", [
            "--expect-tag",
            expected.tag,
            "--expect-sha",
            expected.commit,
            "--expect-version",
            expected.version,
          ]),
        ).rejects.toThrow(`Loom publication pin mismatch for ${field}`);
        expect(spawn.mock.calls.some(([command]) => command !== "git")).toBe(false);
        expect(spawn.mock.calls.some(([, args]) => args?.[0] === "push")).toBe(false);
        expect(
          spawn.mock.calls.some(([, args]) => args?.[0] === "tag" && args[1] !== "--list"),
        ).toBe(false);
      } finally {
        vi.resetAllMocks();
      }
    },
  );
});

describe("published release history lookup", () => {
  it.each([false, true])(
    "generates notes only after a successful published-release lookup (API failure: %s)",
    async (apiFailure) => {
      const stats = await NodeFSP.stat(import.meta.filename);
      const tag = "loom-v0.0.112-nightly.20261022.1";
      const published = "0.0.110-nightly.20261022.1";
      const reserved = "0.0.111-nightly.20261022.1";
      const draft = "0.0.111-nightly.20261022.2";
      const stable = "0.0.111";
      const previousCommit = "a".repeat(40);
      vi.resetAllMocks();
      const spawn = vi.mocked(NodeChildProcess.spawnSync).mockImplementation((command, rawArgs) => {
        const args = [...rawArgs!];
        let stdout = "";
        if (command === "git") {
          if (args[0] === "remote") stdout = "https://github.com/kylebegeman/loom.git";
          else if (args[0] === "for-each-ref") {
            stdout =
              args.at(-1) === "refs/tags/loom-v*"
                ? tag
                : [published, reserved, draft, stable]
                    .map(
                      (name) =>
                        `${name}\tcommit\t${name === published ? previousCommit : "b".repeat(40)}`,
                    )
                    .join("\n");
          } else if (args[0] === "rev-parse") stdout = COMMIT;
          else if (args[0] === "cat-file") stdout = "commit";
          else if (args[0] === "log") {
            expect(args.at(-1)).toBe(`${previousCommit}..${COMMIT}`);
            stdout = "feat(library): integrated feature work\nfix(desktop): include parser license";
          } else if (!["fetch", "tag", "push"].includes(args[0]!)) {
            throw new Error(`Unexpected Git command: ${args.join(" ")}`);
          }
        } else if (command === "gh") {
          if (args[0] === "api") {
            expect(args).toEqual([
              "api",
              "--paginate",
              "repos/kylebegeman/loom/releases?per_page=100",
              "--jq",
              ".[] | select(.draft == false) | .tag_name",
            ]);
            if (apiFailure)
              return {
                pid: 1,
                output: [null, "", "API unavailable"],
                stdout: "",
                stderr: "API unavailable",
                status: 1,
                signal: null,
              };
            stdout = `${published}\n${stable}`;
          } else if (args[0] === "release" && args[1] === "create") {
            throw new Error("Publication boundary reached");
          } else if (args[0] !== "release" || args[1] !== "list") {
            throw new Error(`Unexpected release command: ${args.join(" ")}`);
          }
        } else throw new Error(`Unexpected command: ${command}`);
        return { pid: 1, output: [null, stdout, ""], stdout, stderr: "", status: 0, signal: null };
      });
      try {
        vi.mocked(NodeFS.existsSync).mockReturnValue(false);
        vi.mocked(NodeFSP.mkdir).mockResolvedValue(undefined);
        vi.mocked(NodeFSP.stat).mockImplementation(async (path) => {
          if (String(path).endsWith("connect-config.json"))
            throw Object.assign(new Error("missing"), { code: "ENOENT" });
          return stats;
        });
        vi.mocked(NodeFSP.writeFile).mockResolvedValue();
        vi.mocked(NodeFSP.rm).mockResolvedValue();
        await expect(main("publish")).rejects.toThrow(
          apiFailure ? "API unavailable" : "Publication boundary reached",
        );
        expect(
          spawn.mock.calls.filter(([command, args]) => command === "gh" && args?.[0] === "api"),
        ).toHaveLength(1);
        const notes = vi
          .mocked(NodeFSP.writeFile)
          .mock.calls.find(([path]) => String(path).endsWith("release-notes.md"))?.[1];
        if (apiFailure) {
          expect(notes).toBeUndefined();
          expect(
            spawn.mock.calls.some(([, args]) => args?.[0] === "release" && args[1] === "create"),
          ).toBe(false);
        } else {
          expect(notes).toContain("Library: integrated feature work");
          expect(notes).toContain("Desktop: include parser license");
          expect(notes).toContain(`${published}...0.0.112-nightly.20261022.1`);
        }
      } finally {
        vi.resetAllMocks();
      }
    },
  );
});

describe("prepared Connect decision", () => {
  const tag = "loom-v0.0.48-nightly.20261013.3044";

  it("tells a missing connect.json apart from retirement before anything is published", () => {
    const status = (file: unknown) =>
      describePublisherConnect(() =>
        file === undefined ? undefined : parseLoomConnectConfig(file),
      );
    expect(status(undefined)).toContain("keep a computer's existing link");
    expect(status({ enabled: false })).toContain("retired");
    expect(status(CONNECT_FILE)).toBe("on (relay.example.test)");
    expect(status({ enabled: "false" })).toBe(
      "connect.json is invalid: Loom Connect requires an explicit enabled setting.",
    );
  });

  it.each([
    ["is missing", undefined, undefined],
    ['says "enabled": false', { enabled: false }, "1"],
    ["enables Connect", CONNECT_FILE, undefined],
  ] as const)(
    "builds from a connect.json that %s with only its own retirement and no tracing credentials",
    async (_, file, retired) => {
      const stats = await NodeFSP.stat(import.meta.filename);
      vi.resetAllMocks();
      for (const key of [...T3_TRACING_KEYS, "LOOM_CONNECT_RETIRED", "T3CODE_RELAY_URL"])
        vi.stubEnv(key, "inherited");
      let installEnv: NodeJS.ProcessEnv | undefined;
      vi.mocked(NodeChildProcess.spawnSync).mockImplementation((command, rawArgs, options) => {
        const args = [...rawArgs!];
        let stdout = "";
        if (command === "pnpm") {
          installEnv = options?.env;
          throw new Error("Build boundary reached");
        }
        if (command === "security") stdout = '1) 0123456789 "Loom Local Code Signing"';
        else if (command === "gh") {
          if (args[0] !== "release" || args[1] !== "list")
            throw new Error(`Unexpected release command: ${args.join(" ")}`);
        } else if (command !== "git") throw new Error(`Unexpected command: ${command}`);
        else if (args[0] === "remote") stdout = "https://github.com/kylebegeman/loom.git";
        else if (args[0] === "for-each-ref")
          stdout = args.at(-1) === "refs/tags/loom-v*" ? tag : "";
        else if (args[0] === "rev-parse") stdout = COMMIT;
        else if (args[0] === "cat-file") stdout = "commit";
        else if (!["fetch", "tag", "checkout", "status", "restore"].includes(args[0]!))
          throw new Error(`Unexpected Git command: ${args.join(" ")}`);
        return { pid: 1, output: [null, stdout, ""], stdout, stderr: "", status: 0, signal: null };
      });
      try {
        vi.mocked(NodeFS.existsSync).mockImplementation(
          (path) => file !== undefined && String(path).endsWith("/connect.json"),
        );
        if (file) vi.mocked(NodeFS.readFileSync).mockReturnValue(JSON.stringify(file));
        vi.mocked(NodeFSP.mkdir).mockResolvedValue(undefined);
        vi.mocked(NodeFSP.mkdtemp).mockResolvedValue("/nonexistent/loom-build-staging");
        vi.mocked(NodeFSP.stat).mockImplementation(async (path) => {
          // No prepared record exists, so this run builds afresh.
          if (String(path).includes("Loom Builds"))
            throw Object.assign(new Error("missing"), { code: "ENOENT" });
          return stats;
        });
        vi.mocked(NodeFSP.writeFile).mockResolvedValue();
        vi.mocked(NodeFSP.rm).mockResolvedValue();
        await expect(main("prepare")).rejects.toThrow("Build boundary reached");
        expect(installEnv).toBeDefined();
        for (const key of T3_TRACING_KEYS) expect(installEnv).not.toHaveProperty(key);
        expect(installEnv?.LOOM_CONNECT_RETIRED).toBe(retired);
        expect(installEnv?.T3CODE_RELAY_URL).toBe(
          file === CONNECT_FILE ? CONNECT_CONFIG.relayUrl : undefined,
        );
      } finally {
        vi.unstubAllEnvs();
        vi.resetAllMocks();
      }
    },
  );
});

describe("Loom update publishing", () => {
  it("distinguishes an ad hoc installed app from an update-compatible signing requirement", () => {
    expect(
      installedUpdateRequirement({
        status: 0,
        stdout: '# designated => cdhash H"0123456789012345678901234567890123456789"\n',
        stderr: "Executable=/Applications/Loom.app/Contents/MacOS/Loom\nSignature=adhoc\n",
      }),
    ).toBeNull();
    const expression = 'identifier "com.t3tools.t3code" and anchor trusted';
    for (const stream of ["stdout", "stderr"] as const)
      expect(
        installedUpdateRequirement({
          status: 0,
          stdout: "",
          stderr: "",
          [stream]: `designated => ${expression}\n`,
        }),
      ).toBe(expression);
    for (const result of [
      { status: 1, stdout: `designated => ${expression}`, stderr: "" },
      { status: null, stdout: "", stderr: "Signature=adhoc" },
      { status: 0, stdout: "", stderr: "Signature=adhoc" },
      { status: 0, stdout: "", stderr: "" },
    ])
      expect(() => installedUpdateRequirement(result)).toThrow(
        "Cannot read the installed Loom signing requirement.",
      );
  });

  it("uses only the explicitly prepared public config for desktop and runtime builds", () => {
    const config = CONNECT_CONFIG;
    const inherited = {
      T3CODE_RELAY_URL: "https://wrong.example.test",
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "unqualified",
      LOOM_MOBILE_AUTH_DOMAIN: "wrong.example.test",
      CLERK_SECRET_KEY: "private-must-not-cross",
    };
    const built = buildEnvironment("/source", inherited, config);
    expect(built).toMatchObject({
      T3CODE_RELAY_URL: config.relayUrl,
      T3CODE_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
      LOOM_MOBILE_CONNECT_ENABLED: "1",
    });
    expect(built).not.toHaveProperty("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(built).not.toHaveProperty("LOOM_MOBILE_AUTH_DOMAIN");
    expect(built).not.toHaveProperty("CLERK_SECRET_KEY");
    expect(buildEnvironment("/source", inherited, null)).not.toHaveProperty("T3CODE_RELAY_URL");
  });

  it.each([
    ["Connect on", CONNECT_CONFIG, false],
    ["Connect off", null, false],
    ["Connect retired", null, true],
    ["a command outside a prepared build", undefined, false],
  ] as const)("never bakes relay or mobile tracing credentials for %s", (_, connect, retired) => {
    const inherited = Object.fromEntries(T3_TRACING_KEYS.map((key) => [key, "inherited"]));
    const built = buildEnvironment("/source", inherited, connect, retired);
    for (const key of T3_TRACING_KEYS) expect(built).not.toHaveProperty(key);
  });

  it("retires Connect only for an explicit retirement without a config", () => {
    const inherited = { LOOM_CONNECT_RETIRED: "1" };
    expect(buildEnvironment("/source", inherited, null, true).LOOM_CONNECT_RETIRED).toBe("1");
    for (const [connect, retired] of [
      [null, false],
      [CONNECT_CONFIG, true],
      [CONNECT_CONFIG, false],
      [undefined, true],
      [undefined, false],
    ] as const)
      expect(buildEnvironment("/source", inherited, connect, retired)).not.toHaveProperty(
        "LOOM_CONNECT_RETIRED",
      );
  });

  it("freezes Connect configuration per prepared source and preserves old disabled releases", async () => {
    const directory = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "loom-connect-receipt-"),
    );
    const receipt = NodePath.join(directory, "connect-config.json");
    try {
      expect(await preparedConnect(directory, COMMIT)).toEqual({
        connectConfig: null,
        connectRetired: false,
      });
      // Receipts written before retirement existed have no connectRetired field.
      await NodeFSP.writeFile(
        receipt,
        JSON.stringify({ schemaVersion: 1, sourceSha: COMMIT, connectConfig: CONNECT_CONFIG }),
      );
      expect(await preparedConnect(directory, COMMIT)).toEqual({
        connectConfig: CONNECT_CONFIG,
        connectRetired: false,
      });
      await expect(preparedConnect(directory, "0".repeat(40))).rejects.toThrow("different source");
      for (const connect of [
        { connectConfig: null, connectRetired: true },
        { connectConfig: null, connectRetired: false },
        { connectConfig: CONNECT_CONFIG, connectRetired: false },
      ]) {
        await NodeFSP.writeFile(receipt, connectReceipt(COMMIT, connect));
        expect(await preparedConnect(directory, COMMIT)).toEqual(connect);
      }
      for (const contradiction of [
        { connectConfig: CONNECT_CONFIG, connectRetired: true },
        { connectConfig: null, connectRetired: "1" },
      ]) {
        await NodeFSP.writeFile(
          receipt,
          JSON.stringify({ schemaVersion: 1, sourceSha: COMMIT, ...contradiction }),
        );
        await expect(preparedConnect(directory, COMMIT)).rejects.toThrow("retirement");
      }
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });

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

  it("names the version land tags so the publisher releases exactly that version", () => {
    const publications = ["0.0.55-nightly.20261014.3054", "0.0.9", "before-loom"];
    const version = nextLoomVersion(publications, "v0.0.46-nightly.20261015.3158");
    expect(version).toBe("0.0.56-nightly.20261015.3158");
    expect(nextLoomVersion(publications, "v0.0.46")).toBe("0.0.56");
    expect(nextLoomVersion(publications)).toBe("0.0.56");
    expect(
      releaseForTag(`loom-v${version}`, COMMIT, {
        annotation: `loom-release=${version}`,
        publications: publications.map((tag) => ({ tag, commit: "a".repeat(40) })),
      }).version,
    ).toBe(version);
  });

  it("refuses to invent a Loom version without publication history", () => {
    expect(() => nextLoomVersion(["before-loom"], "v0.0.46")).toThrow("No Loom publication");
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

  it("fetches only missing annotated upstream provenance before reading a fork release", async () => {
    const fixture = await publicationFixture();
    try {
      const ancestor = fixture.commit("upstream source");
      const source = fixture.commit("fork source");
      const upstream = NodePath.join(fixture.root, "upstream.git");
      NodeChildProcess.execFileSync("git", ["init", "--quiet", "--bare", upstream]);
      const tag = "v0.0.46-nightly.20261013.3042";
      fixture.git(
        "push",
        "--quiet",
        upstream,
        `${ancestor}:refs/tags/${tag}`,
        `${ancestor}:refs/tags/v0.0.46-nightly.20261014.1`,
      );
      const candidate = "loom-v0.0.47-nightly.20261013.3045";
      fixture.git("tag", "-a", candidate, "-m", `upstream=${tag}`, source);
      expect(() => releaseFromRepository(fixture.source, candidate)).toThrow("source history");
      ensureUpstreamProvenance(fixture.source, candidate, upstream);
      expect(releaseFromRepository(fixture.source, candidate).upstreamTag).toBe(tag);
      expect(fixture.git("tag", "--list", "v*")).toBe(tag);
      expect(fixture.remoteGit("tag", "--list")).toBe("");
    } finally {
      await NodeFSP.rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("keeps present upstream refs unchanged and does not contact the remote", async () => {
    const fixture = await publicationFixture();
    try {
      const ancestor = fixture.commit("upstream source");
      const source = fixture.commit("fork source");
      const tag = "v0.0.46-nightly.20261013.3042";
      fixture.git("tag", "-a", tag, "-m", "immutable upstream", ancestor);
      const original = fixture.git("rev-parse", `refs/tags/${tag}`);
      const candidate = "loom-v0.0.47-nightly.20261013.3045";
      fixture.git("tag", "-a", candidate, "-m", `Loom built from upstream ${tag}`, source);
      ensureUpstreamProvenance(
        fixture.source,
        candidate,
        NodePath.join(fixture.root, "absent.git"),
      );
      expect(fixture.git("rev-parse", `refs/tags/${tag}`)).toBe(original);
      expect(releaseFromRepository(fixture.source, candidate).upstreamTag).toBe(tag);
    } finally {
      await NodeFSP.rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("refuses invalid provenance names before fetching", async () => {
    const fixture = await publicationFixture();
    try {
      const source = fixture.commit("fork source");
      for (const [index, tag] of [
        "--upload-pack=unsafe",
        "v0.0.46-preview.20261013.1",
        "v0.0.46;echo-unsafe",
      ].entries()) {
        const candidate = `loom-v0.0.47-nightly.20261013.${index + 1}`;
        fixture.git("tag", "-a", candidate, "-m", `upstream=${tag}`, source);
        expect(() =>
          ensureUpstreamProvenance(
            fixture.source,
            candidate,
            NodePath.join(fixture.root, "absent.git"),
          ),
        ).toThrow("Invalid annotated upstream tag");
      }
      expect(fixture.git("tag", "--list", "v*")).toBe("");
    } finally {
      await NodeFSP.rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a fetched upstream tag outside the selected source history", async () => {
    const fixture = await publicationFixture();
    try {
      const source = fixture.commit("fork source");
      const later = fixture.commit("unmerged upstream source");
      const tag = "v0.0.46-nightly.20261013.3042";
      const upstream = NodePath.join(fixture.root, "upstream.git");
      NodeChildProcess.execFileSync("git", ["init", "--quiet", "--bare", upstream]);
      fixture.git("push", "--quiet", upstream, `${later}:refs/tags/${tag}`);
      const candidate = "loom-v0.0.47-nightly.20261013.3045";
      fixture.git("tag", "-a", candidate, "-m", `upstream=${tag}`, source);
      expect(() => ensureUpstreamProvenance(fixture.source, candidate, upstream)).toThrow(
        "not an ancestor",
      );
      expect(() => releaseFromRepository(fixture.source, candidate)).toThrow("source history");
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

  it("includes feature work covered by a failed build reservation in the next release", async () => {
    const fixture = await publicationFixture();
    try {
      fixture.commit("feat(web): published work");
      const published = "0.0.110-nightly.20261022.1";
      fixture.git("tag", published);
      fixture.commit("feat(library): integrated feature work");
      fixture.git("tag", "0.0.111-nightly.20261022.1");
      fixture.commit("fix(desktop): include parser license");
      const integration = "loom-v0.0.112-nightly.20261022.1";
      fixture.git("tag", integration);
      const release = releaseFromRepository(fixture.source, integration);
      expect(release.version).toBe("0.0.112-nightly.20261022.1");

      const history = releaseHistory(release, [published], fixture.source);
      expect(history.previous).toBe(published);
      expect(history.subjects).toEqual([
        "feat(library): integrated feature work",
        "fix(desktop): include parser license",
      ]);
      const notes = releaseNotes(release, history.previous, history.subjects);
      expect(notes).toContain("Library: integrated feature work");
      expect(notes).toContain(`${published}...${release.version}`);
    } finally {
      await NodeFSP.rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("lists the commits since the previous publication as the popover's changes", async () => {
    const fixture = await publicationFixture();
    try {
      fixture.commit("feat(web): earlier work");
      fixture.git("tag", "0.0.64-nightly.20261015.3158");
      fixture.commit("fix(mobile): stable-only fix");
      fixture.git("tag", "0.0.64");
      fixture.commit("feat(library): let projects carry a chosen color");
      fixture.commit("docs(plans): claim LP-01");
      fixture.commit("fix(web): give the computer chip a subtle hover surface");
      const release = releaseForTag(
        "loom-v0.0.65-nightly.20261015.3158",
        fixture.git("rev-parse", "HEAD"),
        {
          upstreamTags: ["v0.0.46-nightly.20261015.3158"],
        },
      );
      const history = releaseHistory(
        release,
        ["0.0.64-nightly.20261015.3158", "0.0.64"],
        fixture.source,
      );
      expect(history.previous).toBe("0.0.64-nightly.20261015.3158");

      const notes = releaseNotes(release, history.previous, history.subjects);
      expect(notes).toContain(
        "https://github.com/kylebegeman/loom/compare/0.0.64-nightly.20261015.3158...0.0.65-nightly.20261015.3158",
      );
      expect(notes).toContain("v0.0.46-nightly.20261015.3158");
      const popover = normalizeDesktopUpdateReleaseNotes(
        [{ version: release.version, note: notes }],
        release.version,
        "nightly",
      );
      expect(popover.releaseNotes).toEqual([
        {
          version: release.version,
          items: [
            "Web: give the computer chip a subtle hover surface",
            "Library: let projects carry a chosen color",
            "Mobile: stable-only fix",
          ],
          totalItems: 3,
        },
      ]);
    } finally {
      await NodeFSP.rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("says so when a publication carries no app changes", () => {
    const release = releaseForTag("loom-v0.0.65-nightly.20261015.3158", COMMIT);
    const notes = releaseNotes(release, "0.0.64-nightly.20261015.3158", ["docs: update plan"]);
    expect(notes).toContain("- No app changes since 0.0.64-nightly.20261015.3158.");
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

  it("gives launchd builds a UTF-8 locale so CocoaPods can install pods", () => {
    expect(buildEnvironment("/tmp/loom-build", {}).LANG).toBe("en_US.UTF-8");
    expect(buildEnvironment("/tmp/loom-build", { LANG: "C" }).LANG).toBe("en_US.UTF-8");
    expect(buildEnvironment("/tmp/loom-build", { LANG: "en_GB.UTF-8" }).LANG).toBe("en_GB.UTF-8");
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
