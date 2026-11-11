import {
  isLibraryBranchName,
  VaultGitHubError,
  type VaultError,
  type VaultGitHubTarget,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as ProcessRunner from "../../processRunner.ts";
import { runRepositoryGit } from "../project-library/runRepositoryGit.ts";
import { githubCredentialHelper } from "./githubCredentialHelper.ts";

export type RepositoryOperation =
  | { readonly kind: "preflight" }
  | {
      readonly kind: "clone";
      readonly path: string;
      readonly branch: string | null;
      readonly onLine?: ((line: string) => Effect.Effect<void>) | undefined;
    };
export type RepositoryAuthorizer = (target: VaultGitHubTarget) => Effect.Effect<void, VaultError>;
export class GitHubRepositoryTransport extends Context.Service<
  GitHubRepositoryTransport,
  {
    readonly execute: (input: {
      readonly repository: string;
      readonly token: Redacted.Redacted<string>;
      readonly operation: RepositoryOperation;
      readonly authorize: Effect.Effect<void, VaultError | VaultGitHubError>;
    }) => Effect.Effect<ProcessRunner.ProcessRunOutput, VaultError | VaultGitHubError>;
  }
>()("t3/fork/vault/GitHubRepositoryTransport") {}

export const layer = Layer.effect(
  GitHubRepositoryTransport,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const host = yield* HostProcess.Environment;
    const platform = yield* HostProcess.Platform;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return GitHubRepositoryTransport.of({
      execute: Effect.fn("GitHubRepositoryTransport.execute")(
        function* (input) {
          if (platform !== "darwin" && platform !== "linux")
            return yield* new VaultGitHubError({ reason: "unsupported" });
          if (!/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/.test(input.repository))
            return yield* new VaultGitHubError({ reason: "invalid-command" });
          const operation = input.operation;
          let destinationExisted = false;
          if (operation.kind === "clone") {
            if (
              !path.isAbsolute(operation.path) ||
              path.normalize(operation.path) !== operation.path ||
              operation.path.includes("\0") ||
              (operation.branch !== null && !isLibraryBranchName(operation.branch))
            )
              return yield* new VaultGitHubError({ reason: "invalid-command" });
            destinationExisted = yield* fs.exists(operation.path);
            let ancestor = operation.path;
            while (!(yield* fs.exists(ancestor))) ancestor = path.dirname(ancestor);
            if (
              (yield* fs.realPath(ancestor)) !== ancestor ||
              (yield* fs.stat(ancestor)).type !== "Directory"
            )
              return yield* new VaultGitHubError({ reason: "invalid-command" });
            if (ancestor === operation.path && (yield* fs.readDirectory(ancestor)).length !== 0)
              return yield* new VaultGitHubError({ reason: "invalid-command" });
          }
          const directory = yield* fs.makeTempDirectoryScoped({
            prefix: "loom-github-repository-",
          });
          yield* fs.chmod(directory, 0o700);
          const templates = path.join(directory, "templates");
          yield* fs.makeDirectory(templates, { mode: 0o700 });
          const helper = path.join(directory, "credential-helper");
          yield* fs.writeFileString(helper, githubCredentialHelper, { mode: 0o700 });
          const config = [
            ["credential.helper", ""],
            ["credential.helper", `!'${helper.replaceAll("'", "'\\''")}'`],
            ["credential.useHttpPath", "true"],
            ["http.followRedirects", "false"],
            ["http.sslVerify", "true"],
            ["http.extraHeader", ""],
            ["http.proxy", ""],
            ["core.hooksPath", "/dev/null"],
            ["protocol.allow", "never"],
            ["protocol.https.allow", "always"],
            ["maintenance.auto", "false"],
            ["gc.auto", "0"],
          ];
          const env: Record<string, string> = {
            PATH: host.PATH ?? "/usr/bin:/bin",
            HOME: directory,
            XDG_CONFIG_HOME: directory,
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_ATTR_NOSYSTEM: "1",
            GIT_TERMINAL_PROMPT: "0",
            GIT_ASKPASS: "/usr/bin/false",
            SSH_ASKPASS: "/usr/bin/false",
            GIT_TEMPLATE_DIR: templates,
            GIT_CEILING_DIRECTORIES: directory,
            GIT_CONFIG_COUNT: String(config.length),
            LC_ALL: "C",
          };
          for (const [index, [key, value]] of config.entries()) {
            env[`GIT_CONFIG_KEY_${index}`] = key!;
            env[`GIT_CONFIG_VALUE_${index}`] = value!;
          }
          yield* input.authorize;
          const token = Redacted.value(input.token);
          env.LOOM_GITHUB_REPOSITORY = input.repository;
          env.LOOM_GITHUB_TOKEN = token;
          const scrub = (value: string, truncated = false) => {
            let safe = value.replaceAll(token, "[redacted]");
            if (!truncated) return safe;
            // Output bounds may cut through a credential at either end.
            for (let length = Math.min(token.length - 1, safe.length); length > 0; length--) {
              if (safe.startsWith(token.slice(-length))) safe = "[redacted]" + safe.slice(length);
              if (safe.endsWith(token.slice(0, length)))
                safe = safe.slice(0, -length) + "[redacted]";
            }
            return safe;
          };
          const remote = `https://github.com/${input.repository}.git`;
          const args =
            operation.kind === "preflight"
              ? ["ls-remote", "--symref", "--", remote, "HEAD"]
              : [
                  "-c",
                  "clone.defaultRemoteName=origin",
                  "clone",
                  "--progress",
                  ...(operation.branch === null ? [] : ["--branch", operation.branch]),
                  "--",
                  remote,
                  operation.path,
                ];
          const cleanPartial =
            operation.kind === "preflight"
              ? Effect.void
              : Effect.gen(function* () {
                  if (
                    !(yield* fs.exists(operation.path)) ||
                    (yield* fs.realPath(operation.path)) !== operation.path
                  )
                    return;
                  if (!destinationExisted)
                    return yield* fs.remove(operation.path, { recursive: true });
                  for (const name of yield* fs.readDirectory(operation.path))
                    yield* fs.remove(path.join(operation.path, name), {
                      recursive: true,
                      force: true,
                    });
                }).pipe(Effect.ignore);
          const result = yield* runRepositoryGit(spawner, args, {
            env,
            cwd: directory,
            extendEnv: false,
            timeout: operation.kind === "preflight" ? "30 seconds" : "10 minutes",
            onLine:
              operation.kind === "clone" && operation.onLine !== undefined
                ? (line) => operation.onLine!(scrub(line))
                : undefined,
          }).pipe(
            Effect.onError(() => cleanPartial),
            Effect.tap((output) =>
              output.code === 0 && !output.timedOut ? Effect.void : cleanPartial,
            ),
            Effect.mapError(() => new VaultGitHubError({ reason: "failed" })),
          );
          return {
            ...result,
            stdout: scrub(result.stdout, result.stdoutTruncated),
            stderr: scrub(result.stderr, result.stderrTruncated),
          };
        },
        Effect.scoped,
        (effect) =>
          effect.pipe(
            Effect.mapError((error) =>
              error._tag === "VaultError" || error._tag === "VaultGitHubError"
                ? error
                : new VaultGitHubError({ reason: "failed" }),
            ),
          ),
      ),
    });
  }),
);
