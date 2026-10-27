import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
// fork: github-host-setup
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { findExecutable as findGitHubExecutable } from "./GitHubHostSetup.ts";

import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

export const layer = Layer.effect(
  SourceControlHost.SourceControlHost,
  Effect.gen(function* () {
    // fork: github-host-setup
    const environment = yield* HostProcess.Environment;
    const delimiter = (yield* HostProcess.Platform) === "win32" ? ";" : ":";
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const process = yield* VcsProcess.VcsProcess;
    const git = yield* GitVcsDriver.GitVcsDriver;
    const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
    return SourceControlHost.SourceControlHost.of({
      settings: { get: serverSettings.getSettings },
      // fork: github-host-setup -- gh runs from the executable host setup finds
      process: {
        run: (input) =>
          input.command === "gh"
            ? findGitHubExecutable(input.env, { preservePathCommand: true }).pipe(
                Effect.provideService(FileSystem.FileSystem, fs),
                Effect.provideService(Path.Path, path),
                Effect.flatMap((command) =>
                  command === null || command === "gh"
                    ? process.run(input)
                    : process.run({
                        ...input,
                        env: {
                          ...environment,
                          ...input.env,
                          PATH: `${path.dirname(command)}${delimiter}${input.env?.PATH ?? environment.PATH ?? ""}`,
                        },
                      }),
                ),
              )
            : process.run(input),
      },
      git: {
        execute: git.execute,
        resolveCommit: git.resolveCommit,
        remotes: (cwd) =>
          vcsRegistry.resolve({ cwd }).pipe(Effect.map((handle) => handle.driver.listRemotes(cwd))),
        readConfigValue: git.readConfigValue,
        resolvePrimaryRemoteName: git.resolvePrimaryRemoteName,
        ensureRemote: git.ensureRemote,
        listLocalBranchNames: git.listLocalBranchNames,
        fetchRemoteBranch: git.fetchRemoteBranch,
        fetchRemoteTrackingBranch: git.fetchRemoteTrackingBranch,
        setBranchUpstream: git.setBranchUpstream,
        switchRef: git.switchRef,
      },
    });
  }),
);
