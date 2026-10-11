import type { EnvironmentAuthorizationError } from "@t3tools/contracts";
import { MODEL_PREVIEW_3D_WS_METHODS as M } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import { ModelPreviewService } from "./ModelPreviewService.ts";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
export const makeModelPreviewRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const service = yield* ModelPreviewService;
    // CAD scripts execute host Python, even when reached through another model operation.
    const cad = (path: string) => /\.b3d\.py$/i.test(path);
    const withTerminal = <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | EnvironmentAuthorizationError, R> => auth.effect(M.renderModel, effect);
    const forFile = <A, E, R>(
      path: string,
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | EnvironmentAuthorizationError, R> =>
      cad(path) ? withTerminal(effect) : effect;
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
      [M.listModels]: (input: {
        threadId: Parameters<typeof service.listModels>[0];
        include?: readonly "build123d"[];
      }) => auth.effect(M.listModels, service.listModels(input.threadId, input.include)),
      [M.turnModels]: (input: {
        threadId: Parameters<typeof service.turnModels>[0];
        runId: Parameters<typeof service.turnModels>[1];
        include?: readonly "build123d"[];
      }) =>
        auth.effect(M.turnModels, service.turnModels(input.threadId, input.runId, input.include)),
      [M.turnModelEvents]: (input: {
        threadId: Parameters<typeof service.turnModelEvents>[0];
        include?: readonly "build123d"[];
      }) => auth.stream(M.turnModelEvents, service.turnModelEvents(input.threadId, input.include)),
      [M.fileUrl]: (
        input: Parameters<typeof service.fileUrl>[0] & { allowLarge?: boolean | undefined },
      ) => auth.effect(M.fileUrl, service.fileUrl(input, input.allowLarge)),
      [M.watch]: (input: Parameters<typeof service.watch>[0]) =>
        auth.stream(M.watch, service.watch(input)),
      [M.parameters]: (input: Parameters<typeof service.parameters>[0]) =>
        auth.effect(M.parameters, service.parameters(input)),
      [M.checkPrint]: (input: Parameters<typeof service.checkPrint>[0]) =>
        auth.effect(M.checkPrint, forFile(input.file.path, service.checkPrint(input))),
      [M.cancelPrintCheck]: (input: Parameters<typeof service.cancelPrintCheck>[0]) =>
        auth.effect(M.cancelPrintCheck, service.cancelPrintCheck(input)),
      [M.renderScad]: (input: Parameters<typeof service.renderScad>[0]) =>
        auth.effect(M.renderScad, forFile(input.file.path, service.renderScad(input))),
      [M.saveParameterSet]: (input: {
        file: Parameters<typeof service.parameters>[0];
        name: string;
        values: Readonly<Record<string, string>>;
      }) =>
        auth.effect(
          M.saveParameterSet,
          service.saveParameterSet(input.file, input.name, input.values),
        ),
      [M.history]: (input: Parameters<typeof service.history>[0]) =>
        auth.effect(M.history, service.history(input)),
      [M.historyVersion]: (input: Parameters<typeof service.historyVersion>[0]) =>
        auth.effect(M.historyVersion, forFile(input.file.path, service.historyVersion(input))),
      [M.historyRestore]: (input: Parameters<typeof service.historyRestore>[0]) =>
        auth.effect(M.historyRestore, service.historyRestore(input)),
      [M.historyUndo]: (input: Parameters<typeof service.historyUndo>[0]) =>
        auth.effect(M.historyUndo, service.historyUndo(input)),
      [M.updateAssembly]: (input: Parameters<typeof service.updateAssembly>[0]) =>
        auth.effect(
          M.updateAssembly,
          input.operations.some((op) => op.op === "align" || op.op === "place-board")
            ? withTerminal(service.updateAssembly(input))
            : service.updateAssembly(input),
        ),
      [M.checkAssembly]: (input: Parameters<typeof service.checkAssembly>[0]) =>
        auth.effect(M.checkAssembly, service.checkAssembly(input)),
      [M.cancelAssemblyCheck]: (input: Parameters<typeof service.cancelAssemblyCheck>[0]) =>
        auth.effect(M.cancelAssemblyCheck, service.cancelAssemblyCheck(input)),
      [M.slice]: (input: Parameters<typeof service.slice>[0]) =>
        auth.effect(M.slice, forFile(input.file.path, service.slice(input))),
      [M.importSlicerProfile]: (input: Parameters<typeof service.importSlicerProfile>[0]) =>
        auth.effect(M.importSlicerProfile, service.importSlicerProfile(input)),
      [M.renderModel]: (input: Parameters<typeof service.renderModel>[0]) =>
        auth.effect(M.renderModel, service.renderModel(input)),
      [M.exportStep]: (input: Parameters<typeof service.exportStep>[0]) =>
        auth.effect(M.exportStep, service.exportStep(input)),
      [M.pythonSetup]: (input: Parameters<typeof service.pythonSetup>[0]) =>
        auth.effect(M.pythonSetup, service.pythonSetup(input)),
      [M.historyCancel]: (input: { file: Parameters<typeof service.historyCancel>[0] }) =>
        auth.effect(M.historyCancel, service.historyCancel(input.file)),
      [M.assembly]: (input: { file: Parameters<typeof service.assembly>[0] }) =>
        auth.effect(M.assembly, service.assembly(input.file)),
      [M.slicerProfiles]: (input: {
        app: Parameters<typeof service.slicerProfiles>[0];
        machine?: string;
      }) => auth.effect(M.slicerProfiles, service.slicerProfiles(input.app, input.machine)),
      [M.openSlice]: (input: { key: string }) =>
        auth.effect(M.openSlice, service.openSlice(input.key)),
      [M.printers]: () => auth.effect(M.printers, service.printers()),
      [M.updatePrinters]: (input: Parameters<typeof service.updatePrinters>[0]) =>
        auth.effect(M.updatePrinters, service.updatePrinters(input)),
      [M.parsePrinterProfile]: (input: Parameters<typeof service.parsePrinterProfile>[0]) =>
        auth.effect(M.parsePrinterProfile, service.parsePrinterProfile(input)),
      [M.getSettings]: () => auth.effect(M.getSettings, service.getSettings()),
      [M.updateSettings]: (input: Parameters<typeof service.updateSettings>[0]) =>
        auth.effect(M.updateSettings, service.updateSettings(input)),
      [M.clearCache]: () => auth.effect(M.clearCache, service.clearCache()),
    };
  });
