// @effect-diagnostics nodeBuiltinImport:off -- SHA-256 is updated incrementally while downloading official archives.
import { parseGitHubDeviceCode } from "./githubDeviceCode.ts";
import * as NodeCrypto from "node:crypto";
import * as NodeStream from "@effect/platform-node/NodeStream";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as HttpClient from "effect/http/HttpClient";
import * as ProcessRunner from "../processRunner.ts";
import { openZipArchive } from "../zipArchive.ts";

const VERSION = "2.102.0";
const RELEASES: Readonly<Record<string, { readonly target: string; readonly sha256: string }>> = {
  "linux-arm64": {
    target: "linux_arm64.tar.gz",
    sha256: "7862c86c72f43df3a2d93ddde6f473285b4e2af61b494849846827e513ef6484",
  },
  "linux-x64": {
    target: "linux_amd64.tar.gz",
    sha256: "bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386",
  },
  "darwin-arm64": {
    target: "macOS_arm64.zip",
    sha256: "da922c20d1792e5b2cbf375593d7a658acf034c12c84e007e71c76ef959c337e",
  },
  "darwin-x64": {
    target: "macOS_amd64.zip",
    sha256: "b245f24eb2bf5f75b426b4c26da3651a107f8d5b6f4fddfbfccc5679041378b3",
  },
  "win32-arm64": {
    target: "windows_arm64.zip",
    sha256: "5dcf12aa8525eabd0c46ec414f323ab6cf65229fc2cd46543cc705001bbaf223",
  },
  "win32-x64": {
    target: "windows_amd64.zip",
    sha256: "ae64e556ecc240b200f7eba60d550e4bb60d78e860e69dd88c449405b86067f4",
  },
};
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const REPOSITORY_PATTERN = /^https:\/\/github\.com\/[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+(?:\.git)?\/?$/;
const MAX_EXECUTABLE_BYTES = 128 * 1024 * 1024;
const messages = {
  unavailable:
    "GitHub sign-in could not be verified. Check this machine's network and GitHub CLI, then retry. Saved authorization was left unchanged.",
  "unsupported-platform":
    "Install GitHub CLI from https://cli.github.com on this machine, then run `t3 github setup` again.",
  "installation-failed":
    "GitHub CLI installation failed. Nothing was activated. Check network access and run `t3 github setup` again.",
  "sign-in-required":
    "GitHub sign-in is required on this machine. Run `t3 github setup` and approve its device code in your browser.",
  "git-setup-failed":
    "GitHub sign-in succeeded, but Git credential setup failed. Check Git installation and run `t3 github setup` again.",
  "repository-invalid":
    "Use a credential-free HTTPS GitHub repository URL, such as https://github.com/owner/repository.git.",
  "repository-unavailable":
    "Git cannot access this repository. Check this machine's GitHub account, repository permission, and network, then run `t3 github setup` again.",
} as const;
export class GitHubHostSetupError extends Schema.TaggedError<GitHubHostSetupError>()(
  "GitHubHostSetupError",
  {
    reason: Schema.Literals(
      Object.keys(messages) as [keyof typeof messages, ...Array<keyof typeof messages>],
    ),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return messages[this.reason];
  }
}

const isSetupError = Schema.is(GitHubHostSetupError);

const managedExecutable = Effect.gen(function* () {
  const path = yield* Path.Path;
  return path.join(
    yield* HostProcess.HomeDirectory,
    ".local",
    "share",
    "loom",
    "tools",
    "github-cli",
    "bin",
    (yield* HostProcess.Platform) === "win32" ? "gh.exe" : "gh",
  );
});

/** Prefer the host's CLI; services also find a user-local installation outside their PATH. */
export const findExecutable = Effect.fn("GitHubHostSetup.findExecutable")(function* (
  environment?: NodeJS.ProcessEnv,
  options?: { readonly preservePathCommand?: boolean },
) {
  const existing = yield* resolveCommandPath("gh", {
    env: environment ?? (yield* HostProcess.Environment),
  }).pipe(Effect.orElseSucceed(() => null));
  if (existing !== null) return options?.preservePathCommand ? "gh" : existing;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const candidates = [
    path.join(home, ".local", "bin", (yield* HostProcess.Platform) === "win32" ? "gh.exe" : "gh"),
    yield* managedExecutable,
  ];
  for (const candidate of candidates) {
    const stat = yield* fs.stat(candidate).pipe(Effect.orElseSucceed(() => null));
    if (
      stat?.type === "File" &&
      ((yield* HostProcess.Platform) === "win32" || (stat.mode & 0o111) !== 0)
    )
      return candidate;
  }
  return null;
});

export const GitHubHostStatus = Schema.Struct({
  // fork: github-host-setup
  account: Schema.optionalKey(Schema.String),
  executable: Schema.NullOr(Schema.String),
  state: Schema.Literals([
    "missing-cli",
    "sign-in-required",
    "signed-in",
    "git-ready",
    "repository-unavailable",
  ]),
});
export type GitHubHostStatus = typeof GitHubHostStatus.Type;
export interface GitHubSetupProgress {
  readonly phase: "checking" | "installing" | "waiting" | "configuring";
  readonly deviceCode?: string;
}

export class GitHubHostSetup extends Context.Service<
  GitHubHostSetup,
  {
    readonly status: (repository?: string) => Effect.Effect<GitHubHostStatus, GitHubHostSetupError>;
    readonly setup: (input: {
      readonly interactive: boolean;
      readonly repository?: string;
      readonly onProgress?: (progress: GitHubSetupProgress) => Effect.Effect<void>;
    }) => Effect.Effect<GitHubHostStatus, GitHubHostSetupError>;
  }
>()("t3/sourceControl/GitHubHostSetup") {}

export const make = Effect.fnUntraced(function* (releases: typeof RELEASES = RELEASES) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const process = yield* ProcessRunner.ProcessRunner;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const http = yield* HttpClient.HttpClient;
  const environment = yield* HostProcess.Environment;
  const platform = yield* HostProcess.Platform;
  const arch = yield* HostProcess.Architecture;
  const home = yield* HostProcess.HomeDirectory;
  const destination = yield* managedExecutable;
  const locate = () =>
    findExecutable(environment).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(HostProcess.HomeDirectory, home),
      Effect.provideService(HostProcess.Platform, platform),
    );
  const execute = (command: string, args: ReadonlyArray<string>) =>
    process.run({
      command,
      args,
      cwd: home,
      env: environment,
      timeout: 15_000,
      timeoutBehavior: "error",
      maxOutputBytes: 64 * 1024,
      outputMode: "truncate",
    });
  // fork: github-host-setup
  const authStatus = Effect.fn("GitHubHostSetup.authStatus")(function* (executable: string) {
    const result = yield* execute(executable, [
      "auth",
      "status",
      "--hostname",
      "github.com",
      "--active",
    ]).pipe(Effect.mapError((cause) => new GitHubHostSetupError({ reason: "unavailable", cause })));
    if (
      result.code !== 0 &&
      /failed to connect|could not resolve|dial tcp|network is unreachable|connection refused|timed out|TLS handshake/i.test(
        result.stderr,
      )
    )
      return yield* new GitHubHostSetupError({ reason: "unavailable" });
    // fork: github-host-setup
    const account =
      /Logged in to github\.com account ([A-Za-z0-9][A-Za-z0-9-]{0,38})(?:\s|$)/i.exec(
        `${result.stdout}\n${result.stderr}`,
      )?.[1];
    return { ready: result.code === 0, ...(account ? { account } : {}) };
  });
  // fork: github-host-setup
  const authReady = Effect.fn("GitHubHostSetup.authReady")((executable: string) =>
    authStatus(executable).pipe(Effect.map((status) => status.ready)),
  );
  const checkRepository = Effect.fn("GitHubHostSetup.checkRepository")(function* (
    repository: string,
  ) {
    if (!REPOSITORY_PATTERN.test(repository))
      return yield* new GitHubHostSetupError({ reason: "repository-invalid" });
    return yield* process
      .run({
        command: "git",
        args: ["ls-remote", "--exit-code", repository, "HEAD"],
        cwd: home,
        env: {
          ...environment,
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: platform === "win32" ? "" : "/bin/false",
        },
        timeout: 20_000,
        timeoutBehavior: "error",
        maxOutputBytes: 8192,
        outputMode: "truncate",
      })
      .pipe(
        Effect.map((result) => result.code === 0 && result.stdout.trim() !== ""),
        Effect.orElseSucceed(() => false),
      );
  });
  const install = Effect.fn("GitHubHostSetup.install")(function* () {
    const release = releases[`${platform}-${arch}`];
    if (!release) return yield* new GitHubHostSetupError({ reason: "unsupported-platform" });
    yield* fs
      .makeDirectory(path.dirname(destination), { recursive: true })
      .pipe(
        Effect.mapError(
          (cause) => new GitHubHostSetupError({ reason: "installation-failed", cause }),
        ),
      );
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const staging = yield* fs.makeTempDirectoryScoped({
          directory: path.dirname(destination),
          prefix: "gh-install-",
        });
        const archive = path.join(staging, "archive");
        const executable = path.join(staging, path.basename(destination));
        const response = yield* http.get(
          `https://github.com/cli/cli/releases/download/v${VERSION}/gh_${VERSION}_${release.target}`,
        );
        if (response.status !== 200)
          return yield* new GitHubHostSetupError({ reason: "installation-failed" });
        const hash = NodeCrypto.createHash("sha256");
        let bytes = 0;
        yield* response.stream.pipe(
          Stream.tap((chunk) =>
            Effect.gen(function* () {
              bytes += chunk.byteLength;
              if (bytes > MAX_ARCHIVE_BYTES)
                return yield* new GitHubHostSetupError({ reason: "installation-failed" });
              hash.update(chunk);
            }),
          ),
          Stream.run(fs.sink(archive, { flag: "wx", mode: 0o600 })),
        );
        if (hash.digest("hex") !== release.sha256)
          return yield* new GitHubHostSetupError({ reason: "installation-failed" });
        if (release.target.endsWith(".tar.gz")) {
          const member = `gh_${VERSION}_${release.target.slice(0, -7)}/bin/gh`;
          const child = yield* spawner.spawn(
            ChildProcess.make("tar", ["-xOf", archive, member], {
              stdin: "ignore",
              stderr: "ignore",
            }),
          );
          yield* Stream.run(child.stdout, fs.sink(executable, { flag: "wx", mode: 0o700 }));
          if ((yield* child.exitCode) !== 0)
            return yield* new GitHubHostSetupError({ reason: "installation-failed" });
        } else {
          const zip = yield* openZipArchive(
            archive,
            (_detail, cause) => new GitHubHostSetupError({ reason: "installation-failed", cause }),
          );
          let found = false;
          for (let entry = yield* zip.next; entry !== null; entry = yield* zip.next) {
            if (
              !entry.fileName.endsWith(`/bin/${path.basename(destination)}`) &&
              entry.fileName !== `bin/${path.basename(destination)}`
            )
              continue;
            if (found || entry.uncompressedSize > MAX_EXECUTABLE_BYTES)
              return yield* new GitHubHostSetupError({ reason: "installation-failed" });
            found = true;
            const readable = yield* zip.streamEntry(entry);
            yield* NodeStream.fromReadable<Uint8Array, GitHubHostSetupError>({
              evaluate: () => readable,
              onError: (cause) =>
                new GitHubHostSetupError({ reason: "installation-failed", cause }),
            }).pipe(Stream.run(fs.sink(executable, { flag: "wx", mode: 0o700 })));
          }
          if (!found) return yield* new GitHubHostSetupError({ reason: "installation-failed" });
        }
        yield* fs.chmod(executable, 0o755);
        const version = yield* execute(executable, ["--version"]);
        if (version.code !== 0 || !version.stdout.startsWith(`gh version ${VERSION} `))
          return yield* new GitHubHostSetupError({ reason: "installation-failed" });
        // A concurrent setup may have published its own verified binary. Never replace it.
        yield* fs.link(executable, destination).pipe(
          Effect.catchIf(
            (cause) => cause.reason._tag === "AlreadyExists",
            () => Effect.void,
          ),
        );
        return destination;
      }),
    ).pipe(
      Effect.timeout("5 minutes"),
      Effect.mapError((cause) =>
        isSetupError(cause)
          ? cause
          : new GitHubHostSetupError({ reason: "installation-failed", cause }),
      ),
    );
  });
  const status = Effect.fn("GitHubHostSetup.status")(function* (repository?: string) {
    if (repository !== undefined && !REPOSITORY_PATTERN.test(repository))
      return yield* new GitHubHostSetupError({ reason: "repository-invalid" });
    const executable = yield* locate();
    if (executable === null) return { executable, state: "missing-cli" } as const;
    // fork: github-host-setup
    const authentication = yield* authStatus(executable);
    if (!authentication.ready) return { executable, state: "sign-in-required" } as const;
    if (repository === undefined)
      return {
        executable,
        state: "signed-in",
        ...(authentication.account ? { account: authentication.account } : {}),
      } as const;
    return {
      executable,
      state: (yield* checkRepository(repository)) ? "git-ready" : "repository-unavailable",
    } as const;
  });
  const setup = Effect.fn("GitHubHostSetup.setup")(function* (input: {
    readonly interactive: boolean;
    readonly repository?: string;
    readonly onProgress?: (progress: GitHubSetupProgress) => Effect.Effect<void>;
  }) {
    if (input.repository !== undefined && !REPOSITORY_PATTERN.test(input.repository))
      return yield* new GitHubHostSetupError({ reason: "repository-invalid" });
    yield* input.onProgress?.({ phase: "checking" }) ?? Effect.void;
    let executable = yield* locate();
    if (executable === null) {
      yield* input.onProgress?.({ phase: "installing" }) ?? Effect.void;
      executable = yield* install();
    }
    if (!(yield* authReady(executable))) {
      if (!input.interactive)
        return yield* new GitHubHostSetupError({ reason: "sign-in-required" });
      const command = [
        "auth",
        "login",
        "--hostname",
        "github.com",
        "--git-protocol",
        "https",
        "--web",
      ];
      // Non-TTY gh prints the code/URL and polls without opening a browser on the server.
      // Only the parsed public device code reaches clients; raw CLI output stays private.
      const login =
        input.onProgress === undefined
          ? spawner.exitCode(
              ChildProcess.make(executable, command, {
                env: environment,
                stdin: "inherit",
                stdout: "inherit",
                stderr: "inherit",
              }),
            )
          : Effect.scoped(
              Effect.gen(function* () {
                const child = yield* spawner.spawn(
                  ChildProcess.make(executable, command, {
                    env: { ...environment, GH_FORCE_TTY: "", NO_COLOR: "1" },
                    stdin: "ignore",
                  }),
                );
                let sent = false;
                const read = (output: Stream.Stream<Uint8Array, PlatformError.PlatformError>) => {
                  let tail = "";
                  return output.pipe(
                    Stream.decodeText(),
                    Stream.runForEach((chunk) =>
                      Effect.gen(function* () {
                        tail = (tail + chunk).slice(-4096);
                        const deviceCode = parseGitHubDeviceCode(tail);
                        if (sent || deviceCode === null) return;
                        sent = true;
                        yield* input.onProgress?.({ phase: "waiting", deviceCode }) ?? Effect.void;
                      }),
                    ),
                  );
                };
                const [, , exitCode] = yield* Effect.all(
                  [read(child.stdout), read(child.stderr), child.exitCode],
                  { concurrency: "unbounded" },
                );
                return exitCode;
              }),
            );
      const code = yield* login.pipe(
        Effect.timeout("15 minutes"),
        Effect.mapError((cause) => new GitHubHostSetupError({ reason: "sign-in-required", cause })),
      );
      if (code !== 0 || !(yield* authReady(executable)))
        return yield* new GitHubHostSetupError({ reason: "sign-in-required" });
    }
    yield* input.onProgress?.({ phase: "configuring" }) ?? Effect.void;
    const configured = yield* execute(executable, [
      "auth",
      "setup-git",
      "--hostname",
      "github.com",
    ]).pipe(
      Effect.mapError((cause) => new GitHubHostSetupError({ reason: "git-setup-failed", cause })),
    );
    if (configured.code !== 0)
      return yield* new GitHubHostSetupError({ reason: "git-setup-failed" });
    if (input.repository !== undefined && !(yield* checkRepository(input.repository)))
      return yield* new GitHubHostSetupError({ reason: "repository-unavailable" });
    return { executable, state: "git-ready" } as const;
  });
  return GitHubHostSetup.of({ status, setup });
});
export const layer = Layer.effect(GitHubHostSetup, make()).pipe(Layer.provide(ProcessRunner.layer));
