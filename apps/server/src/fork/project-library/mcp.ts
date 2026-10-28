import { ProjectWorkflows } from "./ProjectWorkflows.ts";
import { ProjectOperations } from "./ProjectOperations.ts";
import { AuthOrchestrationReadScope, AuthOrchestrationOperateScope } from "@t3tools/contracts";
import * as Library from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ProjectLibraryToolkit } from "./tools.ts";
import { McpInvocationContext, requireThreadScope } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as BriefSuggestions from "./LibraryBriefSuggestions.ts";
import * as PlacementPreview from "./LibraryPlacementPreview.ts";
import * as Publisher from "./LibraryPublisher.ts";
import * as Catalog from "./LibraryService.ts";
import * as Workspace from "./LibraryWorkspace.ts";
import * as Replication from "./LibraryReplication.ts";

const decodeOperationProject = Schema.decodeUnknownEffect(Library.LibraryProject);
const decodeOperationCopy = Schema.decodeUnknownEffect(Library.LibraryWorkingCopy);
const isLibraryFailure = Schema.is(Library.LibraryError);

/** Records which conversation or signed-in agent proposed a brief; request input never chooses it. */
const proposalSource = McpInvocationContext.pipe(
  Effect.map((scope): Library.LibraryBriefProposalSource => {
    if (scope.thread !== undefined)
      return {
        kind: "conversation",
        environmentId: scope.environmentId,
        threadId: scope.thread.threadId,
      };
    const label = scope.client?.label.trim().slice(0, 160).trim();
    return {
      kind: "agent",
      id: scope.client?.sessionId ?? scope.requestNamespace,
      label: label || "Agent",
    };
  }),
);

const operationCallerMissing = () =>
  new Library.LibraryError({
    reason: "blocked",
    detail: "Project operations run only from a conversation or a signed-in app session.",
  });

export const projectLibraryHandlers = McpToolAccess.toLayer(
  ProjectLibraryToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    const operate = Effect.fn("ProjectLibrary.operate")(function* (
      id: string,
      request: Library.LibraryOperationInput,
    ) {
      const invocation = yield* McpInvocationContext;
      return yield* onHost(
        Effect.flatMap(ProjectOperations, (service) =>
          invocation.thread
            ? service.executeAgent(id, request, invocation.thread)
            : invocation.client
              ? service.executeClient(id, request, invocation.client.sessionId)
              : Effect.fail(operationCallerMissing()),
        ),
      );
    });
    const projectOperationId = Effect.fn("ProjectLibrary.operationId")(function* (
      requestId: string,
      kind: Library.LibraryOperationInput["kind"],
    ) {
      return yield* onHost(
        Effect.flatMap(ProjectOperations, (operations) => operations.operationId(requestId, kind)),
      );
    });
    return {
      loom_library_workstreams: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(ProjectWorkflows, (service) => service.workstreams(input))),
      ),
      loom_library_workstream_save: McpToolAccess.writesEnvironment((input) =>
        onHost(Effect.flatMap(ProjectWorkflows, (service) => service.saveWorkstream(input))),
      ),
      loom_library_blueprint: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(ProjectWorkflows, (service) => service.blueprint(input))),
      ),
      loom_library_blueprint_apply: McpToolAccess.writesEnvironment((input) =>
        onHost(Effect.flatMap(ProjectWorkflows, (service) => service.applyBlueprint(input))),
      ),
      loom_library_preservation: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(ProjectWorkflows, (service) => service.preservation(input))),
      ),
      loom_library_operations: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(ProjectOperations, (service) => service.list(input))),
      ),
      loom_library_operation_control: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          const invocation = yield* McpInvocationContext;
          return yield* onHost(
            Effect.flatMap(ProjectOperations, (service) =>
              invocation.thread
                ? service.controlAgent(input.operationId, input.action, invocation.thread)
                : invocation.client
                  ? service.controlClient(
                      input.operationId,
                      input.action,
                      invocation.client.sessionId,
                    )
                  : Effect.fail(operationCallerMissing()),
            ),
          );
        }),
      ),
      loom_library_operation_run: McpToolAccess.writesEnvironment((input) =>
        operate(input.operationId, input.request),
      ),
      loom_library_projects: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(Publisher.LibraryPublisher, (service) =>
            service.projects(
              input.includeArchived === undefined ? {} : { includeArchived: input.includeArchived },
            ),
          ),
        ),
      ),
      loom_library_project: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(BriefSuggestions.LibraryBriefSuggestions, (service) =>
            service.project(input),
          ),
        ),
      ),
      loom_library_conversations: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(Publisher.LibraryPublisher, (service) => service.conversations(input)),
        ),
      ),
      loom_library_lookup_thread: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(Publisher.LibraryPublisher, (service) => service.lookupThread(input)),
        ),
      ),
      loom_library_connection: McpToolAccess.reads(() =>
        onHost(Effect.flatMap(Catalog.LibraryService, (service) => service.info)),
      ),
      loom_library_bound_project: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(Workspace.LibraryWorkspace, (service) =>
            Effect.gen(function* () {
              const project = yield* service.threadProject(input);
              const binding = yield* service.threadBinding(input);
              return project === null || binding === null ? null : { project, binding };
            }),
          ),
        ),
      ),
      loom_library_history: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(Publisher.LibraryPublisher, (service) =>
            service.history({ ...input, offset: input.offset ?? 0, limit: input.limit ?? 50 }),
          ),
        ),
      ),
      loom_library_decisions: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(Publisher.LibraryPublisher, (service) => service.decisions(input))),
      ),
      loom_library_search: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(Publisher.LibraryPublisher, (service) =>
            service.search({ ...input, limit: input.limit ?? 20 }),
          ),
        ),
      ),
      loom_library_timeline: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(Publisher.LibraryPublisher, (service) => service.timeline(input))),
      ),
      loom_library_launch_candidates: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(Publisher.LibraryPublisher, (service) => service.launchCandidates(input)),
        ),
      ),
      loom_library_project_create: McpToolAccess.writesEnvironment((input) =>
        projectOperationId(input.requestId, "create").pipe(
          Effect.flatMap((id) => operate(id, { kind: "create", input })),
          Effect.flatMap((operation) => decodeOperationProject(operation.result)),
          Effect.mapError((cause) =>
            isLibraryFailure(cause) ? cause : new Library.LibraryError({ reason: "io" }),
          ),
        ),
      ),
      loom_library_project_update: McpToolAccess.writesEnvironment((input) =>
        onHost(Effect.flatMap(Catalog.LibraryService, (service) => service.updateProject(input))),
      ),
      loom_library_project_archive: McpToolAccess.writesEnvironment((input) =>
        onHost(Effect.flatMap(Catalog.LibraryService, (service) => service.archiveProject(input))),
      ),
      loom_library_copy_prepare: McpToolAccess.writesEnvironment((input) =>
        projectOperationId(input.requestId, "prepare").pipe(
          Effect.flatMap((id) => operate(id, { kind: "prepare", input })),
          Effect.flatMap((operation) => decodeOperationCopy(operation.result)),
          Effect.mapError((cause) =>
            isLibraryFailure(cause) ? cause : new Library.LibraryError({ reason: "io" }),
          ),
        ),
      ),
      loom_library_copy_placement: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(PlacementPreview.make, (preview) => preview(input))),
      ),
      loom_library_copy_retention: McpToolAccess.writesEnvironment((input) =>
        onHost(
          Effect.flatMap(Workspace.LibraryWorkspace, (service) => service.setCopyRetention(input)),
        ),
      ),
      loom_library_copy_reopen: McpToolAccess.writesEnvironment((input) =>
        projectOperationId(input.requestId, "reopen").pipe(
          Effect.flatMap((id) => operate(id, { kind: "reopen", input })),
          Effect.flatMap((operation) => decodeOperationCopy(operation.result)),
          Effect.mapError((cause) =>
            isLibraryFailure(cause) ? cause : new Library.LibraryError({ reason: "io" }),
          ),
        ),
      ),
      loom_library_copy_snapshot: McpToolAccess.writesEnvironment((input) =>
        projectOperationId(input.requestId, "snapshot").pipe(
          Effect.flatMap((id) => operate(id, { kind: "snapshot", input })),
          Effect.flatMap((operation) => decodeOperationCopy(operation.result)),
          Effect.mapError((cause) =>
            isLibraryFailure(cause) ? cause : new Library.LibraryError({ reason: "io" }),
          ),
        ),
      ),
      loom_library_recovery_authorize: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          const scope = yield* McpInvocationContext;
          const caller = yield* requireThreadScope(scope, "Portable file recovery");
          return yield* onHost(
            Effect.flatMap(Catalog.LibraryService, (service) =>
              service.authorizeRecovery(input, {
                subject: `loom-thread:${caller.thread.threadId}`,
                scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
              }),
            ),
          );
        }),
      ),
      loom_library_copy_restore: McpToolAccess.writesEnvironment((input) =>
        projectOperationId(input.requestId, "restore").pipe(
          Effect.flatMap((id) => operate(id, { kind: "restore", input })),
          Effect.flatMap((operation) => decodeOperationCopy(operation.result)),
          Effect.mapError((cause) =>
            isLibraryFailure(cause) ? cause : new Library.LibraryError({ reason: "io" }),
          ),
        ),
      ),
      loom_library_copy_release: McpToolAccess.writesEnvironment((input) =>
        projectOperationId(input.requestId, "release").pipe(
          Effect.flatMap((id) => operate(id, { kind: "release", input })),
          Effect.flatMap((operation) => decodeOperationCopy(operation.result)),
          Effect.mapError((cause) =>
            isLibraryFailure(cause) ? cause : new Library.LibraryError({ reason: "io" }),
          ),
        ),
      ),
      loom_library_copy_status: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(Workspace.LibraryWorkspace, (service) => service.status(input))),
      ),
      loom_library_profile_readiness: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(Workspace.LibraryWorkspace, (service) => service.readiness(input))),
      ),
      loom_library_binding_resolve: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(Workspace.LibraryWorkspace, (service) => service.resolveBinding(input)),
        ),
      ),
      loom_library_thread_bind: McpToolAccess.writesThreads(
        (input) => [input.threadId],
        (input) =>
          onHost(
            Effect.flatMap(Workspace.LibraryWorkspace, (service) => service.bindThread(input)),
          ),
      ),
      loom_library_brief_propose: McpToolAccess.writes((input) =>
        Effect.flatMap(proposalSource, (source) =>
          onHost(
            Effect.flatMap(BriefSuggestions.LibraryBriefSuggestions, (service) =>
              service.propose(input, source),
            ),
          ),
        ),
      ),
      loom_library_brief_proposals: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(Catalog.LibraryService, (service) => service.briefProposals(input))),
      ),
      loom_library_history_flush: McpToolAccess.writesEnvironment((input) =>
        onHost(
          Effect.flatMap(Replication.LibraryReplication, (service) =>
            service.flush.pipe(Effect.andThen(service.statusFor(input.threadIds))),
          ),
        ),
      ),
    };
  }),
);
