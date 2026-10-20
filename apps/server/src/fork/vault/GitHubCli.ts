// @effect-diagnostics nodeBuiltinImport:off -- This adapter owns one isolated, token-scoped GH child and removes its private config directory.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { VaultGitHubError, type VaultGitHubOperation } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
export class GitHubCli extends Context.Service<
  GitHubCli,
  {
    readonly run: (input: {
      token: Redacted.Redacted<string>;
      repository: string;
      operation: VaultGitHubOperation;
      authorize: Effect.Effect<void, VaultGitHubError>;
    }) => Effect.Effect<{ exitCode: number; stdout: string }, VaultGitHubError>;
  }
>()("t3/fork/vault/GitHubCli") {}
export const githubArgs = (repository: string, op: VaultGitHubOperation): string[] => {
  const repo = ["--repo", repository];
  switch (op.action) {
    case "repo-view":
      return [
        "repo",
        "view",
        repository,
        "--json",
        "nameWithOwner,description,url,defaultBranchRef,isPrivate",
      ];
    case "pr-list":
      return [
        "pr",
        "list",
        ...repo,
        "--limit",
        "20",
        "--json",
        "number,title,state,url,headRefName,baseRefName",
      ];
    case "issue-list":
      return ["issue", "list", ...repo, "--limit", "20", "--json", "number,title,state,url"];
    case "pr-view":
      return [
        "pr",
        "view",
        String(op.number),
        ...repo,
        "--json",
        "number,title,body,state,url,headRefName,baseRefName",
      ];
    case "issue-view":
      return ["issue", "view", String(op.number), ...repo, "--json", "number,title,body,state,url"];
    case "pr-checks":
      return ["pr", "checks", String(op.number), ...repo, "--json", "name,state,link"];
    case "pr-comment":
      return ["pr", "comment", String(op.number), ...repo, "--body", op.body];
    case "issue-comment":
      return ["issue", "comment", String(op.number), ...repo, "--body", op.body];
    case "issue-create":
      return ["issue", "create", ...repo, "--title", op.title, "--body", op.body];
  }
};
const fail = (reason: VaultGitHubError["reason"] = "failed") => new VaultGitHubError({ reason });
export const layer = Layer.effect(
  GitHubCli,
  Effect.gen(function* () {
    const env = yield* HostProcess.Environment,
      platform = yield* HostProcess.Platform;
    return GitHubCli.of({
      run: Effect.fn("GitHubCli.run")(function* (input) {
        if (platform !== "darwin" && platform !== "linux") return yield* fail("unsupported");
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const directory = yield* Effect.acquireRelease(
              Effect.tryPromise({
                try: () => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-gh-")),
                catch: () => fail(),
              }),
              (dir) =>
                Effect.promise(() => NodeFSP.rm(dir, { recursive: true, force: true })).pipe(
                  Effect.ignore,
                ),
            );
            yield* Effect.tryPromise({
              try: () => NodeFSP.chmod(directory, 0o700),
              catch: () => fail(),
            });
            yield* input.authorize;
            return yield* Effect.callback<{ exitCode: number; stdout: string }, VaultGitHubError>(
              (resume) => {
                const child = NodeChildProcess.spawn(
                  "gh",
                  githubArgs(input.repository, input.operation),
                  {
                    cwd: directory,
                    env: {
                      PATH: env.PATH ?? "/usr/bin:/bin",
                      HOME: directory,
                      GH_CONFIG_DIR: directory,
                      GH_TOKEN: Redacted.value(input.token),
                      GH_HOST: "github.com",
                      GH_PROMPT_DISABLED: "1",
                      GH_PAGER: "cat",
                      NO_COLOR: "1",
                    },
                    stdio: ["ignore", "pipe", "pipe"],
                  },
                );
                const chunks: Buffer[] = [];
                let size = 0,
                  failed = false;
                child.stdout.on("data", (chunk: Buffer) => {
                  size += chunk.length;
                  if (size > 16384) {
                    failed = true;
                    child.kill("SIGKILL");
                  } else chunks.push(chunk);
                });
                child.stderr.resume();
                child.once("error", () => resume(Effect.fail(fail("cli-unavailable"))));
                child.once("close", (code) =>
                  resume(
                    code === null || failed
                      ? Effect.fail(fail())
                      : Effect.succeed({
                          exitCode: code,
                          stdout: Buffer.concat(chunks)
                            .toString("utf8")
                            .replaceAll(Redacted.value(input.token), "[redacted]"),
                        }),
                  ),
                );
                return Effect.sync(() => {
                  if (child.exitCode === null) child.kill("SIGKILL");
                });
              },
            ).pipe(
              Effect.timeout("30 seconds"),
              Effect.catchTags({ TimeoutError: () => Effect.fail(fail("timeout")) }),
            );
          }),
        );
      }),
    });
  }),
);
