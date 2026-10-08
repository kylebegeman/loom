import { PcbPreviewRpcGroup, PCB_PREVIEW_WS_METHODS as M } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as PcbPreview from "./PcbPreviewService.ts";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";

export const makePcbPreviewRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const service = yield* PcbPreview.PcbPreviewService;
    return PcbPreviewRpcGroup.of({
      [M.reuseHardware]: (i) => auth.effect(M.reuseHardware, service.reuseHardware(i)),
      [M.workspaceUpdates]: (i) => auth.stream(M.workspaceUpdates, service.workspaceUpdates(i)),
      [M.exportReference]: (i) => auth.effect(M.exportReference, service.exportReference(i)),
      [M.panelEvents]: (i) => auth.stream(M.panelEvents, service.panelEvents(i.threadId)),
      [M.editorEvents]: (i) => auth.stream(M.editorEvents, service.editorEvents(i)),
      [M.editorAction]: (i) => auth.effect(M.editorAction, service.editorAction(i)),
      [M.completeEditorAction]: (i) =>
        auth.effect(M.completeEditorAction, service.completeEditorAction(i)),
      [M.inspect]: (input) => auth.effect(M.inspect, service.inspect(input)),
      [M.workspace]: (input) => auth.effect(M.workspace, service.getWorkspace(input)),
      [M.updateWorkspace]: (input) =>
        auth.effect(M.updateWorkspace, service.updateWorkspace(input)),
      [M.asset]: (input) => auth.effect(M.asset, service.asset(input)),
      [M.compare]: (input) => auth.effect(M.compare, service.compare(input)),
      [M.revisions]: (input) => auth.effect(M.revisions, service.revisions(input)),
      [M.parameters]: (input) => auth.effect(M.parameters, service.parameters(input)),
      [M.applyParameters]: (input) =>
        auth.effect(M.applyParameters, service.applyParameters(input)),
      [M.simulate]: (input) => auth.effect(M.simulate, service.simulate(input)),
      [M.updateLibrary]: (input) => auth.effect(M.updateLibrary, service.updateLibrary(input)),
      [M.library]: () => auth.effect(M.library, service.library()),
      [M.status]: () => auth.effect(M.status, service.status()),
      [M.listDesigns]: (input) => auth.effect(M.listDesigns, service.listDesigns(input)),
      [M.render]: (input) => auth.effect(M.render, service.render(input)),
      [M.readSheet]: (input) => auth.effect(M.readSheet, service.readSheet(input)),
      [M.check]: (input) => auth.effect(M.check, service.check(input)),
      [M.latestChecks]: (input) => auth.effect(M.latestChecks, service.latestChecks(input)),
      [M.watch]: (input) => auth.stream(M.watch, service.watch(input)),
    });
  });
