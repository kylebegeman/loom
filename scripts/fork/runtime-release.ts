// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - Installed publisher has only Node built-ins.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";

const REPOSITORY = "kylebegeman/loom";
const PLATFORMS = ["darwin-arm64", "linux-arm64", "linux-x64"] as const;
const PUBLIC_FIELDS = {
  T3CODE_CLERK_PUBLISHABLE_KEY: "clerk_publishable_key",
  T3CODE_CLERK_JWT_TEMPLATE: "clerk_jwt_template",
  T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "clerk_cli_oauth_client_id",
  T3CODE_RELAY_URL: "relay_url",
} as const;

export function validateRuntimeRelease(version: string, sourceSha: string) {
  if (
    version.trim() !== version ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-nightly\.[1-9]\d{7}\.\d+)?$/.test(version)
  )
    throw new Error("Runtime archives require an exact Loom release version.");
  if (sourceSha.length !== 40 || !/^[a-f0-9]{40}$/.test(sourceSha))
    throw new Error("Runtime archives require an exact source commit.");
  return { version, sourceSha };
}

export function runtimeReleaseAssets(version: string): string[] {
  validateRuntimeRelease(version, "0".repeat(40));
  return [...PLATFORMS.map((platform) => `t3-${version}-${platform}.tar.gz`), "SHA256SUMS"];
}

export function runtimeReleaseComplete(version: string, assets: readonly string[]) {
  const existing = new Set(assets);
  return runtimeReleaseAssets(version).every((asset) => existing.has(asset));
}

// The publisher passes its build environment, whose PATH finds Homebrew's gh under launchd.
function gh(env: Readonly<Record<string, string | undefined>>, args: string[]): string {
  const result = NodeChildProcess.spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 60_000,
    env: { ...env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`GitHub runtime release operation failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

/** Checks the release before dispatch and after the exact-source build finishes. */
export async function ensureRuntimeReleaseAssets(input: {
  readonly version: string;
  readonly sourceSha: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log?: (message: string) => void;
}) {
  validateRuntimeRelease(input.version, input.sourceSha);
  const release = () =>
    JSON.parse(
      gh(input.env, [
        "release",
        "view",
        input.version,
        "--repo",
        REPOSITORY,
        "--json",
        "assets,isDraft",
      ]),
    ) as { assets: Array<{ name: string }>; isDraft: boolean };
  const current = release();
  if (
    runtimeReleaseComplete(
      input.version,
      current.assets.map((asset) => asset.name),
    )
  )
    return;
  if (!current.isDraft)
    throw new Error("A published release has incomplete runtime archives; refusing to rewrite it.");

  const runs = () =>
    JSON.parse(
      gh(input.env, [
        "run",
        "list",
        "--repo",
        REPOSITORY,
        "--workflow",
        "loom-cli-archives.yml",
        "--limit",
        "50",
        "--json",
        "databaseId,displayTitle,status,conclusion,headSha",
      ]),
    ) as Array<{
      databaseId: number;
      displayTitle: string;
      status: string;
      conclusion: string | null;
      headSha: string;
    }>;
  // A publisher restart must keep watching its exact-source build, rather than
  // queueing another hour of identical work behind a still-running attempt.
  const active = runs().find(
    (run) =>
      run.displayTitle.startsWith(`Loom runtimes ${input.version} `) &&
      run.headSha === input.sourceSha &&
      run.status !== "completed",
  );
  const title = active?.displayTitle ?? `Loom runtimes ${input.version} ${NodeCrypto.randomUUID()}`;
  let runId = active?.databaseId;
  if (active) {
    input.log?.(
      `Resuming runtime build: https://github.com/${REPOSITORY}/actions/runs/${active.databaseId}`,
    );
  } else {
    const args = [
      "workflow",
      "run",
      "loom-cli-archives.yml",
      "--repo",
      REPOSITORY,
      "--ref",
      input.version,
      "-f",
      `version=${input.version}`,
      "-f",
      `source_sha=${input.sourceSha}`,
      "-f",
      `request_id=${title.slice(`Loom runtimes ${input.version} `.length)}`,
    ];
    for (const [key, field] of Object.entries(PUBLIC_FIELDS))
      args.push("-f", `${field}=${input.env[key]?.trim() ?? ""}`);
    // Sent only when the publisher retired Connect, so while Connect is on a retry still dispatches
    // against a release tag whose workflow predates this input.
    if (input.env.LOOM_CONNECT_RETIRED === "1") args.push("-f", "connect_retired=1");
    gh(input.env, args);
    input.log?.(`Building checked runtime archives for ${input.version}.`);
  }

  const deadline = Date.now() + 60 * 60 * 1000;
  while (Date.now() < deadline) {
    const run = runs().find((run) => run.displayTitle === title && run.headSha === input.sourceSha);
    if (run) {
      if (runId === undefined) {
        runId = run.databaseId;
        input.log?.(`Runtime build: https://github.com/${REPOSITORY}/actions/runs/${runId}`);
      }
      if (run.status === "completed") {
        if (run.conclusion !== "success")
          throw new Error(
            `Runtime archive build ${run.databaseId} ended with ${run.conclusion}. The release remains a draft.`,
          );
        if (
          !runtimeReleaseComplete(
            input.version,
            release().assets.map((asset) => asset.name),
          )
        )
          throw new Error(
            "Runtime build completed without every required archive and checksum manifest.",
          );
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(
    `Runtime archive build timed out${runId ? ` (${runId})` : ""}; the release remains a draft.`,
  );
}
