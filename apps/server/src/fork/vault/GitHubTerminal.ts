// @effect-diagnostics nodeBuiltinImport:off -- This adapter owns command-scoped children, private helper files and process-group cleanup.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  VaultConnectionError,
  VaultGitHubError,
  type VaultGitHubTerminalCommand,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { githubTerminalArgs } from "./GitHubCommand.ts";

type Output = { exitCode: number; stdout: string; stderr: string };
export class GitHubTerminal extends Context.Service<
  GitHubTerminal,
  {
    readonly execute: (input: {
      token: Redacted.Redacted<string>;
      repository: string;
      command: VaultGitHubTerminalCommand;
      cwd: string | null;
      authorize: Effect.Effect<void, VaultGitHubError | VaultConnectionError>;
    }) => Effect.Effect<Output, VaultGitHubError | VaultConnectionError>;
  }
>()("t3/fork/vault/GitHubTerminal") {}
const helper = `#!/bin/sh
[ "$1" = get ] || exit 0
protocol= host= path=
while IFS= read -r line && [ -n "$line" ]; do
  case "$line" in
    protocol=*) protocol=\${line#protocol=} ;;
    host=*) host=\${line#host=} ;;
    path=*) path=\${line#path=} ;;
  esac
done
[ "$protocol" = https ] && [ "$host" = github.com ] || exit 1
[ "$path" = "$LOOM_GITHUB_REPOSITORY" ] || [ "$path" = "$LOOM_GITHUB_REPOSITORY.git" ] || exit 1
printf 'username=x-access-token\\npassword=%s\\n\\n' "$LOOM_GITHUB_TOKEN"
`;
const fail = (reason: VaultGitHubError["reason"]) => new VaultGitHubError({ reason });
const forbiddenConfig =
  /^(include\.|includeif\.|credential\.|http\.|https\.|url\.|filter\.|alias\.|protocol\.|core\.(sshcommand|gitproxy|hookspath|fsmonitor)|remote\..*\.(uploadpack|receivepack|proxy|vcs|pushoption)|push\.pushoption)/i;
const OUTPUT_LIMIT = 65536;
export const layer = Layer.effect(
  GitHubTerminal,
  Effect.gen(function* () {
    const host = yield* HostProcess.Environment,
      platform = yield* HostProcess.Platform;
    const spawn = (
      tool: string,
      args: ReadonlyArray<string>,
      cwd: string,
      env: Record<string, string>,
    ) =>
      Effect.callback<Output, VaultGitHubError>((resume) => {
        const child = NodeChildProcess.spawn(tool, [...args], {
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
        });
        const stdout: Buffer[] = [],
          stderr: Buffer[] = [];
        let bytes = 0,
          overflow = false;
        const stop = () => {
          if (child.pid) {
            try {
              NodeProcess.kill(-child.pid, "SIGKILL");
            } catch {
              /* The scoped group has already exited. */
            }
          }
        };
        const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > OUTPUT_LIMIT) {
            overflow = true;
            stop();
          } else chunks.push(chunk);
        };
        child.stdout.on("data", collect(stdout));
        child.stderr.on("data", collect(stderr));
        child.once("error", () => resume(Effect.fail(fail("cli-unavailable"))));
        child.once("close", (code) =>
          resume(
            code === null || overflow
              ? Effect.fail(fail("failed"))
              : Effect.succeed({
                  exitCode: code,
                  stdout: Buffer.concat(stdout).toString("utf8"),
                  stderr: Buffer.concat(stderr).toString("utf8"),
                }),
          ),
        );
        return Effect.sync(stop);
      }).pipe(
        Effect.timeout("120 seconds"),
        Effect.catchTags({ TimeoutError: () => Effect.fail(fail("timeout")) }),
      );
    return GitHubTerminal.of({
      execute: Effect.fn("GitHubTerminal.execute")(function* (input) {
        if (platform !== "darwin" && platform !== "linux") return yield* fail("unsupported");
        const args = githubTerminalArgs(input.repository, input.command);
        if (!args) return yield* fail("invalid-command");
        const directory = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-github-command-")),
            catch: () => fail("failed"),
          }),
          (dir) =>
            Effect.promise(() => NodeFSP.rm(dir, { recursive: true, force: true })).pipe(
              Effect.ignore,
            ),
        );
        yield* Effect.tryPromise({
          try: async () => {
            await NodeFSP.chmod(directory, 0o700);
            await NodeFSP.mkdir(NodePath.join(directory, "templates"), { mode: 0o700 });
          },
          catch: () => fail("failed"),
        });
        const env: Record<string, string> = {
          PATH: host.PATH ?? "/usr/bin:/bin",
          HOME: directory,
          XDG_CONFIG_HOME: directory,
          GH_CONFIG_DIR: directory,
          GH_HOST: "github.com",
          GH_REPO: input.repository,
          GH_PROMPT_DISABLED: "1",
          GH_PAGER: "cat",
          GH_BROWSER: "false",
          GH_EDITOR: "false",
          NO_COLOR: "1",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_ATTR_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "/usr/bin/false",
          SSH_ASKPASS: "/usr/bin/false",
          GIT_TEMPLATE_DIR: NodePath.join(directory, "templates"),
        };
        const cwd = input.cwd ?? directory;
        if (input.cwd) {
          // Reject repository settings that could redirect authentication or start credential-bearing subprocesses.
          const config = yield* spawn(
            "git",
            ["config", "--includes", "--name-only", "--list"],
            cwd,
            env,
          );
          if (config.exitCode !== 0) return yield* fail("failed");
          if (config.stdout.split(/\r?\n/).some((key) => forbiddenConfig.test(key)))
            return yield* fail("unsafe-git-config");
        }
        {
          const filename = NodePath.join(directory, "credential-helper");
          yield* Effect.tryPromise({
            try: () => NodeFSP.writeFile(filename, helper, { mode: 0o700 }),
            catch: () => fail("failed"),
          });
          const config = [
            ["credential.helper", ""],
            ["credential.helper", `!'${filename.replaceAll("'", "'\\''")}'`],
            ["credential.useHttpPath", "true"],
            ["http.followRedirects", "false"],
            ["http.sslVerify", "true"],
            ["http.extraHeader", ""],
            ["http.proxy", ""],
            ["core.hooksPath", "/dev/null"],
            ["protocol.allow", "never"],
            ["protocol.https.allow", "always"],
            ["remote.origin.url", `https://github.com/${input.repository}.git`],
            ["remote.origin.pushurl", `https://github.com/${input.repository}.git`],
            ["maintenance.auto", "false"],
            ["gc.auto", "0"],
            ["push.gpgSign", "false"],
          ];
          env.GIT_CONFIG_COUNT = String(config.length);
          for (const [index, [key, value]] of config.entries()) {
            env[`GIT_CONFIG_KEY_${index}`] = key!;
            env[`GIT_CONFIG_VALUE_${index}`] = value!;
          }
          env.LOOM_GITHUB_REPOSITORY = input.repository;
          env.LOOM_GITHUB_TOKEN = Redacted.value(input.token);
        }
        if (input.command.tool === "gh") env.GH_TOKEN = Redacted.value(input.token);
        yield* input.authorize;
        const output = yield* spawn(input.command.tool, args, cwd, env);
        const scrub = (value: string) =>
          value.replaceAll(Redacted.value(input.token), "[redacted]");
        return { ...output, stdout: scrub(output.stdout), stderr: scrub(output.stderr) };
      }, Effect.scoped),
    });
  }),
);
