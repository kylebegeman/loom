// fork: mini-native-retention
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
