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
import { githubTerminalArgs, VAULT_PUSH_REMOTE } from "./GitHubCommand.ts";

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
// core.hooksPath is always overridden to /dev/null before credentials reach a child.
const forbiddenConfig =
  /^(include\.|includeif\.|credential\.|http\.|https\.|url\.|filter\.|alias\.|protocol\.|core\.(sshcommand|gitproxy|fsmonitor)|remote\..*\.(uploadpack|receivepack|proxy|vcs|pushoption)|push\.pushoption)/i;
const OUTPUT_LIMIT = 65536;
// Skip consumed values so flag-shaped titles, notes and patterns stay text.
const releaseFileValues = new Set([
  "--target",
  "--title",
  "-t",
  "--notes",
  "-n",
  "--notes-file",
  "--notes-start-tag",
]);
const releaseDownloadValues = new Set(["--dir", "--pattern", "-p", "--archive", "-A"]);
const literalPath = (value: string) =>
  value.length > 0 && value !== "-" && !/[\0*?[\]{}\\]/.test(value);
const validateReleaseFiles = async (args: string[], cwd: string | null) => {
  const action = args[1];
  if (!action || !["create", "edit", "upload", "download"].includes(action)) return;
  const positionalEnd = args.indexOf("--repo", 2);
  if (positionalEnd < 0) throw fail("invalid-command");
  const paths: { index: number; asset: boolean; directory: boolean }[] = [];
  if (action === "create" || action === "upload") {
    for (let index = 3; index < positionalEnd; index++)
      paths.push({ index, asset: true, directory: false });
  }
  const valueFlags = action === "download" ? releaseDownloadValues : releaseFileValues;
  for (let index = positionalEnd + 2; index < args.length;) {
    const flag = args[index]!;
    const name = flag.split("=", 1)[0]!;
    if (action === "download" && (name === "--output" || name === "--clobber"))
      throw fail("invalid-command");
    if (flag === "--notes-file" || (action === "download" && flag === "--dir")) {
      paths.push({ index: index + 1, asset: false, directory: flag === "--dir" });
    }
    index += valueFlags.has(flag) ? 2 : 1;
  }
  if (action === "download" && !paths.some((path) => path.directory)) throw fail("invalid-command");
  if (paths.length === 0) return;
  if (cwd === null) throw fail("invalid-command");
  const root = await NodeFSP.realpath(cwd);
  if (!(await NodeFSP.stat(root)).isDirectory()) throw fail("invalid-command");
  for (const path of paths) {
    const value = args[path.index];
    if (!value) throw fail("invalid-command");
    const labelIndex = path.asset ? value.indexOf("#") : -1;
    const filename = labelIndex < 0 ? value : value.slice(0, labelIndex);
    if (!literalPath(filename)) throw fail("invalid-command");
    const resolved = await NodeFSP.realpath(NodePath.resolve(root, filename));
    // gh treats the first # as an asset label separator even in a canonical path.
    if (path.asset && resolved.includes("#")) throw fail("invalid-command");
    const relative = NodePath.relative(root, resolved);
    if (
      relative === ".." ||
      relative.startsWith(`..${NodePath.sep}`) ||
      NodePath.isAbsolute(relative) ||
      !literalPath(resolved)
    )
      throw fail("invalid-command");
    const stat = await NodeFSP.stat(resolved);
    if (path.directory) {
      // No pre-existing child, including a symlink, may receive downloaded content.
      if (!stat.isDirectory() || (await NodeFSP.readdir(resolved)).length !== 0)
        throw fail("invalid-command");
    } else if (!stat.isFile()) throw fail("invalid-command");
    // Pass the canonical path to gh so it uses the checked parent directory.
    args[path.index] = resolved + (labelIndex < 0 ? "" : value.slice(labelIndex));
  }
};
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
        if (input.command.tool === "gh" && args[0] === "release") {
          yield* Effect.tryPromise({
            try: () => validateReleaseFiles(args, input.cwd),
            catch: () => fail("invalid-command"),
          });
        }
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
        const local = { ...env };
        if (input.cwd) {
          // Reject repository settings that could redirect authentication or start credential-bearing subprocesses.
          const config = yield* spawn(
            "git",
            ["config", "--includes", "--name-only", "--list"],
            cwd,
            env,
          );
          if (config.exitCode !== 0) return yield* fail("failed");
          if (
            config.stdout
              .split(/\r?\n/)
              .some(
                (key) =>
                  forbiddenConfig.test(key) || key.startsWith(`remote.${VAULT_PUSH_REMOTE}.`),
              )
          )
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
            [`remote.${VAULT_PUSH_REMOTE}.url`, `https://github.com/${input.repository}.git`],
            [`remote.${VAULT_PUSH_REMOTE}.fetch`, "+refs/heads/*:refs/remotes/origin/*"],
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
        // --set-upstream and push.autoSetupRemote record the push remote, which exists only in this
        // command. Point those branches at origin even after a failed or interrupted push.
        const upstreams = Effect.gen(function* () {
          const listed = yield* spawn(
            "git",
            ["config", "--null", "--get-regexp", "^branch\\..*\\.remote$"],
            cwd,
            local,
          );
          for (const entry of listed.stdout.split("\0")) {
            const [key, value] = entry.split("\n");
            if (key && value === VAULT_PUSH_REMOTE)
              yield* spawn("git", ["config", key, "origin"], cwd, local);
          }
        }).pipe(Effect.ignore);
        const command = spawn(input.command.tool, args, cwd, env);
        const output = yield* input.command.tool === "git" && args[0] === "push"
          ? command.pipe(Effect.ensuring(upstreams))
          : command;
        const scrub = (value: string) =>
          value
            .replaceAll(Redacted.value(input.token), "[redacted]")
            .replaceAll(`'${VAULT_PUSH_REMOTE}/`, "'origin/")
            .replaceAll(`'${VAULT_PUSH_REMOTE}'`, "'origin'");
        return { ...output, stdout: scrub(output.stdout), stderr: scrub(output.stderr) };
      }, Effect.scoped),
    });
  }),
);
