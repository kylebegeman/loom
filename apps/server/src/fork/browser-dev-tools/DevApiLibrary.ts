import {
  type LibraryManagementActor,
  type DevApiShare,
  type DevApiShareResult,
  LibraryError,
  DevApiError,
  type DevEnvironmentError,
  type DevHttpError,
  type VaultError,
} from "@t3tools/contracts/fork";
import type { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { apiBundleDifferences } from "./apiPortable.ts";
import { LibraryWorkspaceStore } from "../project-library/LibraryWorkspaceStore.ts";
import { LibraryManagement } from "../project-library/LibraryManagement.ts";
import { DevApiService } from "./DevApiService.ts";
import { DevEnvironmentService } from "./DevEnvironmentService.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
type Caller =
  | LibraryManagementActor
  | {
      readonly kind: "agentCaller";
      readonly threadId: ThreadId;
      readonly providerInstanceId: ProviderInstanceId;
    };
export class DevApiLibrary extends Context.Service<
  DevApiLibrary,
  {
    readonly execute: (
      input: DevApiShare,
      caller: Caller,
    ) => Effect.Effect<
      DevApiShareResult,
      LibraryError | DevApiError | DevEnvironmentError | DevHttpError | VaultError
    >;
  }
>()("t3/fork/browser-dev-tools/DevApiLibrary") {}
const make = Effect.gen(function* () {
  const api = yield* DevApiService;
  const workspaces = yield* LibraryWorkspaceStore;
  const management = yield* LibraryManagement;
  const dev = yield* DevEnvironmentService;
  const threads = yield* ThreadManagementService;
  const execute = Effect.fn("DevApiLibrary.execute")(function* (
    input: DevApiShare,
    caller: Caller,
  ) {
    yield* dev.snapshot(input);
    const saved = yield* workspaces.savedBinding(input.threadId);
    const bound = saved?.project ?? (yield* workspaces.getBoundProject(input.threadId));
    const shell = yield* threads
      .getThreadShell(input.threadId)
      .pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause })));
    const receipts = bound ? [] : yield* workspaces.receipts;
    const project =
      bound ??
      receipts.find(
        (r) =>
          r.copy.rootLocalProjectId === shell?.projectId ||
          r.copy.repositories.some((repository) => repository.localProjectId === shell?.projectId),
      )?.project;
    if (!project)
      return yield* new LibraryError({
        reason: "blocked",
        detail: "Save this project's folder to Projects before sharing its API workspace.",
      });
    const local = input.workspaceId
      ? yield* api.read({ threadId: input.threadId, workspaceId: input.workspaceId })
      : null;
    if (local?.library && local.library.projectId !== project.id)
      return yield* new LibraryError({
        reason: "blocked",
        detail: "This workspace belongs to another Library project.",
      });
    const sharedId = input.sharedId ?? local?.library?.sharedId ?? local?.workspace.id;
    const send = (request: Parameters<LibraryManagement["Service"]["apiWorkspace"]>[0]) =>
      caller.kind === "agentCaller"
        ? management.apiWorkspaceAgent(request, caller)
        : management.apiWorkspace(request, caller);
    if (input.action === "publish") {
      if (
        !local ||
        !input.workspaceId ||
        input.expectedLocalRevision !== local.revision ||
        input.expectedSharedRevision === undefined
      )
        return yield* new DevApiError({ reason: "revision-conflict" });
      const bundle = yield* api.bundle({
        threadId: input.threadId,
        workspaceId: input.workspaceId,
      });
      const catalog = yield* send({
        projectId: project.id,
        action: "save",
        workspaceId: bundle.id,
        expectedRevision: input.expectedSharedRevision,
        requestId: input.requestId,
        bundle,
      });
      const details = yield* api.markShared({
        threadId: input.threadId,
        workspaceId: input.workspaceId,
        expectedRevision: input.expectedLocalRevision,
        binding: {
          projectId: project.id,
          sharedId: bundle.id,
          sharedRevision: catalog.revision,
          baseRevision: "",
        },
      });
      return { catalog, details, differences: [] };
    }
    const catalog = yield* send({
      projectId: project.id,
      action: input.action === "list" ? "list" : input.action === "remove" ? "remove" : "read",
      ...(sharedId ? { workspaceId: sharedId } : {}),
      ...(input.action === "remove"
        ? {
            requestId: input.requestId,
            ...(input.expectedSharedRevision === undefined
              ? {}
              : { expectedRevision: input.expectedSharedRevision }),
          }
        : {}),
    });
    const differences =
      local && catalog.selected && input.workspaceId
        ? apiBundleDifferences(
            yield* api.bundle({ threadId: input.threadId, workspaceId: input.workspaceId }),
            catalog.selected,
          )
        : [];
    if (input.action !== "pull") return { catalog, details: local, differences };
    if (!catalog.selected || catalog.revision !== input.expectedSharedRevision)
      return yield* new LibraryError({ reason: "revision-conflict" });
    if (local && local.revision !== input.expectedLocalRevision)
      return yield* new DevApiError({ reason: "revision-conflict" });
    if (local && (!local.library || local.revision !== local.library.baseRevision)) {
      if (!input.keepLocalCopy || !input.workspaceId)
        return yield* new LibraryError({
          reason: "revision-conflict",
          detail:
            "This computer has API edits. Keep a local copy before loading the Library version.",
        });
      yield* api.forkWorkspace({
        threadId: input.threadId,
        workspaceId: input.workspaceId,
        expectedRevision: local.revision,
        requestId: input.requestId,
      });
    }
    if (
      !local &&
      (yield* api.list({ threadId: input.threadId })).some((w) => w.id === catalog.selected?.id)
    )
      return yield* new LibraryError({
        reason: "revision-conflict",
        detail: "A local copy already exists. Select it before updating from Library.",
      });
    const details = yield* api.installBundle({
      threadId: input.threadId,
      ...(local ? { expectedRevision: local.revision } : {}),
      requestId: input.requestId,
      bundle: catalog.selected,
      binding: {
        projectId: project.id,
        sharedId: catalog.selected.id,
        sharedRevision: catalog.revision,
        baseRevision: "",
      },
    });
    return { catalog, details, differences: [] };
  });
  return DevApiLibrary.of({ execute });
});
export const layer = Layer.effect(DevApiLibrary, make);
