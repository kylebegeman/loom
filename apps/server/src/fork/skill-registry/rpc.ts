import {
  SKILL_REGISTRY_WS_METHODS as M,
  type SkillFetchInput,
  type SkillFileInput,
  type SkillInstallInput,
  type SkillScaffoldInput,
  type SkillSetEnabledInput,
  type SkillUpdateInput,
  type SkillWriteInput,
} from "@t3tools/contracts/fork";
import type { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { SkillRegistryService } from "./SkillRegistryService.ts";

export const makeSkillRegistryRpcHandlers = Effect.fn("SkillRegistry.makeRpcHandlers")(function* (
  auth: ForkRpcAuth,
) {
  const service = yield* SkillRegistryService;
  return {
    [M.inventory]: (input: {
      readonly projectId: ProjectId | null;
      readonly refresh?: boolean | undefined;
    }) => auth.effect(M.inventory, service.inventory(input)),
    [M.sources]: () => auth.effect(M.sources, service.sources),
    [M.fetchSource]: (input: SkillFetchInput) =>
      auth.effect(M.fetchSource, service.fetchSource(input)),
    [M.watchFetch]: (input: { readonly requestId: string }) =>
      auth.stream(M.watchFetch, service.watchFetch(input.requestId)),
    [M.cancelFetch]: (input: { readonly requestId: string }) =>
      auth.effect(M.cancelFetch, service.cancelFetch(input.requestId)),
    [M.install]: (input: SkillInstallInput) => auth.effect(M.install, service.install(input)),
    [M.previewUpdate]: (input: {
      readonly projectId: ProjectId | null;
      readonly installId: string;
    }) => auth.effect(M.previewUpdate, service.previewUpdate(input)),
    [M.update]: (input: SkillUpdateInput) => auth.effect(M.update, service.update(input)),
    [M.remove]: (input: SkillFileInput & { readonly expectedHash: string }) =>
      auth.effect(M.remove, service.remove(input)),
    [M.readSkill]: (input: SkillFileInput) => auth.effect(M.readSkill, service.readSkill(input)),
    [M.writeSkill]: (input: SkillWriteInput) =>
      auth.effect(M.writeSkill, service.writeSkill(input)),
    [M.scaffold]: (input: SkillScaffoldInput) => auth.effect(M.scaffold, service.scaffold(input)),
    [M.setEnabled]: (input: SkillSetEnabledInput) =>
      auth.effect(M.setEnabled, service.setEnabled(input)),
    [M.validate]: (input: { readonly text: string; readonly folderName: string }) =>
      auth.effect(M.validate, service.validate(input)),
  };
});
