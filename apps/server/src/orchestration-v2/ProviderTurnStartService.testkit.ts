// fork: mini-native-retention
import { SourceControlProviderError, SourceControlProviderKind } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ServerConfig from "../config.ts";
import * as GitManager from "../git/GitManager.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProjectConfig from "../vcs/VcsProjectConfig.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
// fork: project-lifecycle
import * as NodePath from "@effect/platform-node/NodePath";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts"; // fork: mini-native-retention
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ProjectService from "../project/ProjectService.ts";

// fork: project-lifecycle -- turn start restores worktrees and runs their setup.
export const layerWorkspacePreparation = Layer.mergeAll(
  NodePath.layer,
  WorktreeSetupTracker.layer,
  Layer.mock(GitVcsDriver.GitVcsDriver)({}), // fork: mini-native-retention
  Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
    runForThread: () => Effect.succeed({ status: "no-script" }),
  }),
);

export const layer = Layer.mergeAll(
  layerWorkspacePreparation,
  Layer.mock(GitWorkflow.GitWorkflowService)({
    hasCommit: () => Effect.succeed(true), // fork: library-projects
    pruneWorktrees: () => Effect.void,
    createWorktree: () => Effect.succeed({} as never),
  }),
  Layer.mock(ProjectService.ProjectService)({
    getById: () => Effect.succeedNone,
  }),
);

// Keep repository detection, branch selection and worktree creation on the real Git path.
export const layerRealGit = GitWorkflow.layer.pipe(
  Layer.provide(GitManager.layer),
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
        resolveLink: () => undefined,
        resolve: ({ cwd }) =>
          Effect.fail(
            new SourceControlProviderError({
              provider: SourceControlProviderKind.make("unknown"),
              operation: "resolve",
              cwd,
              detail: "No source control provider in tests",
            }),
          ),
      }),
      Layer.mock(TextGeneration.TextGeneration)({}),
      Layer.mock(ProviderRegistry.ProviderRegistry)({}),
      Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
      Layer.mock(ProjectionStore.ProjectionStoreV2)({}),
      Layer.mock(ProjectStore.ProjectStoreV2)({}),
      ServerSettings.layerTest(),
    ),
  ),
  Layer.provide(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProjectConfig.layer))),
  Layer.provideMerge(GitVcsDriver.layer),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-recreate-" })),
  Layer.provideMerge(NodeServices.layer),
);
