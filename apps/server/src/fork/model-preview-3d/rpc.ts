import { MODEL_PREVIEW_3D_WS_METHODS as M } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import { ModelPreviewService } from "./ModelPreviewService.ts";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
export const makeModelPreviewRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const service = yield* ModelPreviewService;
    return {
      [M.editorEvents]: (i: Parameters<typeof service.editorEvents>[0]) =>
        auth.stream(M.editorEvents, service.editorEvents(i)),
      [M.panelEvents]: (i: { threadId: Parameters<typeof service.panelEvents>[0] }) =>
        auth.stream(M.panelEvents, service.panelEvents(i.threadId)),
      [M.editorAction]: (i: Parameters<typeof service.editorAction>[0]) =>
        auth.effect(M.editorAction, service.editorAction(i)),
      [M.completeEditorAction]: (i: Parameters<typeof service.completeEditorAction>[0]) =>
        auth.effect(M.completeEditorAction, service.completeEditorAction(i)),
      [M.workspace]: (input: Parameters<typeof service.watchWorkspace>[0]) =>
        auth.stream(M.workspace, service.watchWorkspace(input)),
      [M.updateWorkspace]: (input: {
        file: Parameters<typeof service.updateWorkspace>[0];
        operation: Parameters<typeof service.updateWorkspace>[1];
      }) => auth.effect(M.updateWorkspace, service.updateWorkspace(input.file, input.operation)),
      [M.cancelVariant]: (input: {
        file: Parameters<typeof service.cancelVariant>[0];
        variantId: string;
      }) => auth.effect(M.cancelVariant, service.cancelVariant(input.file, input.variantId)),
      [M.status]: (input: { refresh?: boolean | undefined }) =>
        auth.effect(M.status, service.status(input.refresh)),
      [M.listModels]: (
        input: Parameters<typeof service.listModels>[0] extends infer Id ? { threadId: Id } : never,
      ) => auth.effect(M.listModels, service.listModels(input.threadId)),
      [M.fileUrl]: (
        input: Parameters<typeof service.fileUrl>[0] & { allowLarge?: boolean | undefined },
      ) => auth.effect(M.fileUrl, service.fileUrl(input, input.allowLarge)),
      [M.watch]: (input: Parameters<typeof service.watch>[0]) =>
        auth.stream(M.watch, service.watch(input)),
      [M.parameters]: (input: Parameters<typeof service.parameters>[0]) =>
        auth.effect(M.parameters, service.parameters(input)),
      [M.renderScad]: (input: Parameters<typeof service.renderScad>[0]) =>
        auth.effect(M.renderScad, service.renderScad(input)),
      [M.saveParameterSet]: (input: {
        file: Parameters<typeof service.parameters>[0];
        name: string;
        values: Readonly<Record<string, string>>;
      }) =>
        auth.effect(
          M.saveParameterSet,
          service.saveParameterSet(input.file, input.name, input.values),
        ),
      [M.getSettings]: () => auth.effect(M.getSettings, service.getSettings()),
      [M.updateSettings]: (input: Parameters<typeof service.updateSettings>[0]) =>
        auth.effect(M.updateSettings, service.updateSettings(input)),
      [M.clearCache]: () => auth.effect(M.clearCache, service.clearCache()),
    };
  });
