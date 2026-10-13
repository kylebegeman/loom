// fork: mini-native-retention
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodePath from "@effect/platform-node/NodePath";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import * as Option from "effect/Option";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ProjectService from "../project/ProjectService.ts";

export const layerWorkspacePreparation = Layer.mergeAll(
  NodePath.layer,
  WorktreeSetupTracker.layer,
  Layer.mock(GitVcsDriver.GitVcsDriver)({}),
  Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
    runForThread: () => Effect.succeed({ status: "no-script" }),
  }),
);

export const layer = Layer.mergeAll(
  layerWorkspacePreparation,
  Layer.mock(GitWorkflow.GitWorkflowService)({
    pruneWorktrees: () => Effect.void,
    createWorktree: () => Effect.succeed({} as never),
  }),
  Layer.mock(ProjectService.ProjectService)({
    getById: () => Effect.succeed(Option.none()),
  }),
);
