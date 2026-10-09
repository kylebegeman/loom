import type { ProjectId } from "@t3tools/contracts";
import {
  CODE_GRAPH_WS_METHODS as G,
  type CodeGraphBuildMode,
  type CodeGraphImpactInput,
  type CodeGraphSettingsPatch,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { CodeGraphService } from "./CodeGraphService.ts";

export const makeCodeGraphRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const service = yield* CodeGraphService;
    return {
      [G.status]: (input: { projectId: ProjectId }) =>
        auth.effect(G.status, service.status(input.projectId)),
      [G.subscribeStatus]: (input: { projectId: ProjectId }) =>
        auth.stream(G.subscribeStatus, service.subscribeStatus(input.projectId)),
      [G.list]: () => auth.effect(G.list, service.list),
      [G.build]: (input: { projectId: ProjectId; mode: CodeGraphBuildMode }) =>
        auth.effect(G.build, service.build(input.projectId, input.mode)),
      [G.cancel]: (input: { projectId: ProjectId }) =>
        auth.effect(G.cancel, service.cancel(input.projectId)),
      [G.deleteGraph]: (input: { projectId: ProjectId }) =>
        auth.effect(G.deleteGraph, service.deleteGraph(input.projectId)),
      [G.summary]: (input: { projectId: ProjectId }) =>
        auth.effect(G.summary, service.summary(input.projectId)),
      [G.search]: (input: { projectId: ProjectId; query: string }) =>
        auth.effect(G.search, service.search(input.projectId, input.query)),
      [G.neighborhood]: (input: {
        projectId: ProjectId;
        nodeId: string;
        depth?: 1 | 2 | undefined;
      }) =>
        auth.effect(
          G.neighborhood,
          service.neighborhood(input.projectId, input.nodeId, input.depth),
        ),
      [G.impact]: (input: CodeGraphImpactInput) => auth.effect(G.impact, service.impact(input)),
      [G.setAgentTool]: (input: { projectId: ProjectId; enabled: boolean }) =>
        auth.effect(G.setAgentTool, service.setAgentTool(input.projectId, input.enabled)),
      [G.noteProjectOpened]: (input: { projectId: ProjectId }) =>
        auth.effect(G.noteProjectOpened, service.noteProjectOpened(input.projectId)),
      [G.getSettings]: () => auth.effect(G.getSettings, service.getSettings),
      [G.updateSettings]: (input: CodeGraphSettingsPatch) =>
        auth.effect(G.updateSettings, service.updateSettings(input)),
    };
  });
