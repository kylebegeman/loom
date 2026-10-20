import { VaultError, type VaultMigrationDependency } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as ProcessRunner from "../../processRunner.ts";

const endpoint = (raw: string) => {
  const unknown = {
    transport: "other" as const,
    hostname: null,
    port: null,
    repository: null,
    gitPath: null,
    embeddedAuthentication: false,
  };
  if (
    [...raw].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
  )
    return unknown;
  let url: URL;
  let configuredPath: string;
  try {
    if (/^(ssh|https):\/\//i.test(raw)) {
      url = new URL(raw);
      configuredPath = /^(?:ssh|https):\/\/[^/?#]*(\/[^?#]*)/i.exec(raw)?.[1] ?? "";
    } else {
      if (raw.includes("://") || raw.includes("::")) return unknown;
      const match = /^(?:[^@/:]+@)?([a-zA-Z0-9.-]+):(.+)$/.exec(raw);
      if (!match || match[1]!.length < 2 || /^[a-zA-Z]:[\\/]/.test(raw)) return unknown;
      url = new URL(`ssh://${match[1]}/${match[2]}`);
      configuredPath = match[2]!.split(/[?#]/)[0]!;
    }
    if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(url.hostname)) return unknown;
    const ssh = url.protocol === "ssh:";
    const path = configuredPath.replace(/^\//, "");
    const safePath =
      /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) &&
      path.length <= 512 &&
      !path.split("/").some((part) => part === "." || part === "..");
    return {
      transport: ssh ? ("ssh" as const) : ("https" as const),
      hostname: url.hostname,
      port: url.port ? Number(url.port) : ssh ? 22 : 443,
      repository: safePath ? path.replace(/\.git$/, "") : null,
      gitPath: ssh && safePath && configuredPath.length <= 512 ? configuredPath : null,
      embeddedAuthentication:
        !!url.password || (!ssh && !!url.username) || !!url.search || !!url.hash,
    };
  } catch {
    return unknown;
  }
};
// This parser only sees selected local config keys. It never returns URLs, helper bodies or SSH command text.
export const parseMigrationGitMetadata = (raw: string) => {
  const dependencies: VaultMigrationDependency[] = [];
  const positions = new Map<string, number>();
  let localSshCommand = false,
    localCredentialHelper = false,
    localUrlRewrite = false,
    omitted = 0;
  for (const entry of raw.split("\0")) {
    if (!entry) continue;
    const at = entry.indexOf("\n");
    if (at < 0) throw new Error("Invalid Git metadata");
    const key = entry.slice(0, at),
      value = entry.slice(at + 1);
    const lower = key.toLowerCase();
    if (lower === "core.sshcommand") localSshCommand = true;
    else if (/^credential(?:\..*)?\.helper$/.test(lower)) localCredentialHelper = true;
    else if (/^url\..*\.(?:insteadof|pushinsteadof)$/.test(lower)) localUrlRewrite = true;
    else {
      const match = /^remote\.(.*)\.(url|pushurl)$/.exec(key);
      if (!match || !/^[A-Za-z0-9_./-]{1,100}$/.test(match[1]!)) {
        omitted++;
        continue;
      }
      const position = positions.get(key) ?? 0;
      positions.set(key, position + 1);
      dependencies.push({
        remote: match[1]!,
        direction: match[2] === "url" ? "fetch" : "push",
        position,
        ...endpoint(value),
      });
    }
  }
  return {
    dependencies: dependencies.slice(0, 40),
    omittedDependencies: omitted + Math.max(0, dependencies.length - 40),
    localSshCommand,
    localCredentialHelper,
    localUrlRewrite,
  };
};
export class MigrationGitMetadata extends Context.Service<
  MigrationGitMetadata,
  {
    readonly read: (cwd: string) => Effect.Effect<
      {
        readonly raw: Redacted.Redacted<string>;
        readonly metadata: ReturnType<typeof parseMigrationGitMetadata>;
      },
      VaultError
    >;
  }
>()("t3/fork/vault/MigrationGitMetadata") {}
const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner,
    env = yield* HostProcess.Environment;
  return MigrationGitMetadata.of({
    read: Effect.fn("MigrationGitMetadata.read")(function* (cwd) {
      const result = yield* runner
        .run({
          command: "git",
          cwd,
          args: [
            "--no-optional-locks",
            "-c",
            "core.fsmonitor=false",
            "config",
            "--local",
            "--no-includes",
            "--null",
            "--get-regexp",
            "^(remote\\..*\\.(url|pushurl)|core\\.sshcommand|credential(\\..*)?\\.helper|url\\..*\\.(insteadof|pushinsteadof))$",
          ],
          env: {
            PATH: env.PATH ?? "/usr/bin:/bin",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_TERMINAL_PROMPT: "0",
            GIT_OPTIONAL_LOCKS: "0",
          },
          extendEnv: false,
          timeout: "5 seconds",
          maxOutputBytes: 256 * 1024,
        })
        .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" })));
      if (
        (result.code !== 0 && result.code !== 1) ||
        result.timedOut ||
        result.stdoutTruncated ||
        result.stdoutInvalidUtf8
      )
        return yield* new VaultError({ reason: "unavailable" });
      return yield* Effect.try({
        try: () => ({
          raw: Redacted.make(result.stdout),
          metadata: parseMigrationGitMetadata(result.stdout),
        }),
        catch: () => new VaultError({ reason: "invalid-response" }),
      });
    }),
  });
});
export const layer = Layer.effect(MigrationGitMetadata, make).pipe(
  Layer.provide(ProcessRunner.layer),
);
