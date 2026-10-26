import { ProjectWorkflows } from "./ProjectWorkflows.ts";
import { ProjectOperations } from "./ProjectOperations.ts";
import {
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  OrchestratorMcpFailure,
  ThreadId,
} from "@t3tools/contracts";
import * as Library from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext, requireThreadScope } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { MAX_PENDING_BRIEF_PROPOSALS } from "./LibraryBriefProposals.ts";
import * as BriefSuggestions from "./LibraryBriefSuggestions.ts";
import * as Publisher from "./LibraryPublisher.ts";
import * as Catalog from "./LibraryService.ts";
import * as Workspace from "./LibraryWorkspace.ts";
import * as Replication from "./LibraryReplication.ts";

const decodeOperationProject = Schema.decodeUnknownEffect(Library.LibraryProject);
const decodeOperationCopy = Schema.decodeUnknownEffect(Library.LibraryWorkingCopy);
const isLibraryFailure = Schema.is(Library.LibraryError);

const failure = Schema.Union([Library.LibraryError, OrchestratorMcpFailure]);
const dependencies = [McpInvocationContext, ThreadManagementService];
const colorNames = Library.LIBRARY_PROJECT_COLORS.join(", ");
const createProjectParameters = Schema.Struct({
  ...Library.LibraryCreateProjectRequest.fields,
  color: Schema.optional(
    Library.LibraryProjectColor.annotate({
      description: `Project color: one of ${colorNames}. Omit for a stable automatic color.`,
    }),
  ),
});
const updateProjectParameters = Schema.Struct({
  ...Library.LibraryUpdateProjectRequest.fields,
  color: Schema.optional(
    Schema.NullOr(Library.LibraryProjectColor).annotate({
      description: `Project color: one of ${colorNames}. Omit to keep the saved color; null returns to the automatic color.`,
    }),
  ),
  profile: Schema.optional(
    Schema.NullOr(Library.LibraryProjectProfileInput).annotate({
      description: `Project setup: scripts, default model, required tools (ids from ${Library.LIBRARY_TOOL_IDS.join(", ")}, each with an optional minimum version like 20 or 3.12; other ids are refused unless the project already lists them), secret names (environment variable names such as GITHUB_TOKEN, never values), preferred computer ids and whether Mini may run its jobs. New text that looks like a token, password or random key is refused, and the error names the field; entries already saved are kept. Send the whole profile: it replaces the saved one. Omit to keep the saved profile; null removes it.`,
    }),
  ),
});
const searchParameters = Schema.Struct({
  ...Library.LibrarySearchRequest.fields,
  limit: Schema.optional(Library.LibrarySearchRequest.fields.limit),
});
// Agents reuse a saved project, so its nested profile need not be repeated in the launch input.
// Keep the JSON decoder: production MCP also accepts null for optional project/profile fields.
const launchOperationParameters = Schema.Struct({
  ...Library.LibraryLaunchOperation.fields,
  project: Schema.Record(Schema.String, Schema.Unknown)
    .annotate({
      description: "Complete project returned by loom_library_project; pass it unchanged.",
    })
    .pipe(Schema.decodeTo(Schema.toCodecJson(Library.LibraryProject))),
});
// The full archive still validates and encodes the result. Only its advertised projection is
// loose; encoding it again as a record preserves every field without inlining the turn unions.
// MCP requires JSON structured content, and the projection's own encoding keeps DateTime values.
const historyResult = Schema.toEncoded(
  Schema.Struct({
    ...Library.LibraryThreadArchive.fields,
    projection: Schema.Record(Schema.String, Schema.Unknown).annotate({
      description:
        "Saved thread projection, including thread, messages, turnItems, visibleTurnItems and updatedAt.",
    }),
  }),
).pipe(Schema.decodeTo(Schema.toCodecJson(Library.LibraryThreadArchive)));
export const ProjectLibraryToolkit = Toolkit.make(
  Tool.make("loom_library_workstreams", {
    description: "List optional durable workstreams and linked work for a project.",
    parameters: Schema.Struct({ projectId: Library.LibraryId }),
    success: Schema.Array(Library.LibraryWorkstream),
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_workstream_save", {
    description:
      "Create, revise, archive or reopen a workstream. Completion refuses unfinished links and local work. Verification and PR states are explicit recorded observations, not inferred CI results.",
    parameters: Library.LibrarySaveWorkstream,
    success: Library.LibraryWorkstream,
    failure,
    dependencies,
  }),
  Tool.make("loom_library_blueprint", {
    description:
      "Export version 1 portable repository layout and setup. Omits computer paths, credentials and provider selections.",
    parameters: Schema.Struct({ projectId: Library.LibraryId }),
    success: Library.LibraryBlueprint,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_blueprint_apply", {
    description:
      "Apply a reviewed portable blueprint to a project revision. Does not execute its scripts or change existing copies or conversation pins.",
    parameters: Schema.Struct({
      requestId: Library.LibraryRequestId,
      projectId: Library.LibraryId,
      expectedRevision: Schema.Int,
      blueprint: Library.LibraryBlueprint,
    }),
    success: Library.LibraryProject,
    failure,
    dependencies,
  }),
  Tool.make("loom_library_preservation", {
    description:
      "Review saved cross-project preservation observations. Connect each computer and use copy status for a current guarded removal preview. Missing observations never mean files are safe to delete.",
    parameters: Schema.Struct({ projectId: Schema.optional(Library.LibraryId) }),
    success: Schema.Array(Library.LibraryPreservationEntry),
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_operations", {
    description:
      "Read durable project operations on this computer, including progress, failures and safe repair instructions.",
    parameters: Schema.Struct({ projectId: Schema.optional(Library.LibraryId) }),
    success: Schema.Array(Library.LibraryOperation),
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_operation_control", {
    description:
      "Resume an interrupted project operation or cancel its remaining steps. Completed steps are preserved. Only the original owner or calling thread may control it; authorization is checked again.",
    parameters: Schema.Struct({
      operationId: Library.LibraryRequestId,
      action: Schema.Literals(["resume", "cancel"]),
    }),
    success: Library.LibraryOperation,
    failure,
    dependencies,
  }),
  Tool.make("loom_library_operation_run", {
    description:
      "Launch a bound Library conversation. Reuse operationId and identical input after a lost response. For other jobs use the direct project and copy tools; resume or cancel with loom_library_operation_control. Prefer t3_thread_launch for a registered local Library copy.",
    parameters: Schema.Struct({
      operationId: Library.LibraryRequestId,
      request: Schema.Struct({
        kind: Schema.Literal("launch"),
        input: launchOperationParameters,
      }),
    }),
    success: Library.LibraryOperation,
    failure,
    dependencies,
  }),
  Tool.make("loom_library_projects", {
    description: "List durable projects in this Library, independent of working computers.",
    parameters: Schema.Struct({ includeArchived: Schema.optional(Schema.Boolean) }),
    success: Schema.Array(Library.LibraryProject),
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_project", {
    description: "Read a project's shared brief and repository components.",
    parameters: Schema.Struct({ projectId: Library.LibraryId }),
    success: Library.LibraryProject,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_conversations", {
    description:
      "Read a bounded page of saved conversations with source computer and watermark. Omit projectId to search all Library projects. Follow nextOffset for the next page.",
    parameters: Library.LibraryConversationsRead,
    success: Library.LibraryThreadIndex,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_lookup_thread", {
    description:
      "Resolve an original computer/conversation deep link to its saved Library metadata without downloading history.",
    parameters: Schema.Struct({
      sourceEnvironmentId: Library.LibraryThreadBinding.fields.environmentId,
      threadId: ThreadId,
    }),
    success: Schema.NullOr(Library.LibraryThreadSummary),
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_connection", {
    description:
      "Read this computer's Library role and enrolled shared Library destination. Includes no credentials.",
    parameters: Tool.EmptyParams,
    success: Library.LibraryInfo,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_bound_project", {
    description:
      "Read the pinned project brief and repository scope for a conversation on this execution computer, even when its Library is offline.",
    parameters: Schema.Struct({ threadId: ThreadId }),
    success: Schema.NullOr(
      Schema.Struct({ project: Library.LibraryProject, binding: Library.LibraryThreadBinding }),
    ),
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_history", {
    description:
      "Read a bounded page of saved conversation history without contacting the original computer. Follow window.nextOffset for earlier items.",
    parameters: Schema.Struct({
      id: Library.LibraryId,
      offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
      limit: Schema.optional(
        Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)),
      ),
    }),
    success: historyResult,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_decisions", {
    description:
      "Search committed default-branch decisions and catalogued ideas from Library project repositories. Returns source repository, path, anchor, date and status. Superseded records are hidden unless includeRetired is true. Scope by projectId or kind. Keyword search works without the semantic model.",
    parameters: Library.LibraryDecisionsSearchInput,
    success: Library.LibraryDecisionsSearchResult,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_search", {
    description:
      'Search saved conversation messages and plans across every computer, including offline ones. Every word must match; quote an exact phrase. A Library with semantic search also returns messages close in meaning, marked match "semantic"; pass semantic false, or quote a phrase, to match words only. Scope by projectId, environmentId or an ISO since/until. Pass nextCursor as cursor for the next page; later pages leave out history saved after the first. To read a hit in context, call loom_library_history with its id; history offsets count back from the newest item, so offset window.totalItems - 1 - position ends the page at the hit.',
    parameters: searchParameters,
    success: Library.LibrarySearchResult,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_timeline", {
    description: `Read what happened in a project, newest first, up to 200 entries a page. Optional kinds filters to: ${Library.LIBRARY_TIMELINE_KINDS.join(", ")}. Pass nextBefore as before for older entries. Entries marked approximate were rebuilt from records saved before the timeline existed.`,
    parameters: Library.LibraryTimelineRequest,
    success: Library.LibraryTimelinePage,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_launch_candidates", {
    description:
      "Rank where a Library project's next conversation should start, best first, as the New conversation dialog does: computers seen recently before offline ones, a copy covering the components before getting one, up to date before stale, then the computer used most recently. Each candidate has plain reasons and at most one is preselected. Omit resourceIds for the whole project. Required tools are not checked here; call loom_library_profile_readiness on a computer for that.",
    parameters: Library.LibraryLaunchCandidatesRequest,
    success: Library.LibraryLaunchCandidates,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_project_create", {
    description: "Create a durable project and shared brief. No computer or folder is selected.",
    parameters: createProjectParameters,
    success: Library.LibraryProject,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_library_project_update", {
    description:
      "Save a new project context revision with optimistic conflict checks. Existing conversations keep their pinned context.",
    parameters: updateProjectParameters,
    success: Library.LibraryProject,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_library_project_archive", {
    description: "Archive or reopen a durable project. Preserves files and conversation history.",
    parameters: Library.LibraryArchiveProjectRequest,
    success: Library.LibraryProject,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_library_copy_prepare", {
    description:
      "Reuse an existing folder or clone all selected project repositories beneath one parent on this computer. Prefer reuse. A folder registered only to archived projects, or to ones the Library no longer has, moves to this project; their old conversations keep their history. A folder that any current project holds, or that holds files Loom created, is refused with the reason, naming the current project when there is one, as is one whose owners the Library cannot confirm. Retry with the same requestId after a failure.",
    parameters: Library.LibraryPrepareCopyRequest,
    success: Library.LibraryWorkingCopy,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_library_copy_retention", {
    description:
      "Keep managed project files on this computer, or allow automatic cleanup after all work finishes. Existing folders are always preserved.",
    parameters: Library.LibrarySetCopyRetentionRequest,
    success: Library.LibraryWorkingCopy,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_library_copy_reopen", {
    description:
      "Restore removed managed project files from their verified recovery archive on this computer, preserving local files, Git objects and conversation bindings. Keeps the restored files on this computer.",
    parameters: Library.LibraryReopenCopyRequest,
    success: Library.LibraryWorkingCopy,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_library_copy_snapshot", {
    description:
      "Save and verify the current project files for use on another computer without removing the originals. Review with loom_library_copy_status first. Retain requestId and reviewToken for retries; active work prevents saving.",
    parameters: Library.LibrarySnapshotCopyRequest,
    success: Library.LibraryWorkingCopy,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_library_recovery_authorize", {
    description:
      "On the Library authority, authorize one verified saved file archive for the chosen destination computer. Only an in-app full-access conversation may request this short-lived grant. Pass the grant directly to loom_library_copy_restore on that computer; never persist or share its access token.",
    parameters: Library.LibraryAuthorizeRecoveryRequest,
    success: Library.LibraryRecoveryGrant,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_library_copy_restore", {
    description:
      "Restore verified saved project files into a new location on this computer using a destination-specific Library grant. Preserves local files, unpushed Git work and checkpoint refs, creates new destination project identities, and never overwrites an existing folder. Retain requestId for retries; renew expired grants. Keeps files until the new conversation is bound and retention is explicitly chosen.",
    parameters: Library.LibraryRestoreCopyRequest,
    success: Library.LibraryWorkingCopy,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_library_copy_release", {
    description:
      "Remove managed project files only after saving and verifying their full recovery archive. Review with loom_library_copy_status first and pass its current reviewToken; refuses while it lists blockers or releaseBlockers. For an existing external folder, only removes its Library registration and preserves all files. Projects and saved conversation history persist.",
    parameters: Library.LibraryReleaseCopyRequest,
    success: Library.LibraryWorkingCopy,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
  Tool.make("loom_library_copy_status", {
    description:
      "Review working-copy ownership, active bindings, cleanup blockers and each repository's branch, ahead/behind counts and uncommitted files. releaseBlockers name what must be resolved before files can be removed, such as Git worktrees made from them that still exist elsewhere; they do not stop a snapshot. A current reviewToken is needed to release.",
    parameters: Schema.Struct({ workingCopyId: Library.LibraryId }),
    success: Library.LibraryCopyStatus,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_profile_readiness", {
    description:
      "Check a Library project's required tools on this computer: ok, missing, outdated (with the version found) or unknown when a check could not run. Also lists the secret names to configure; secret values are never read. Pass the current profile from loom_library_project when this computer has no copy yet.",
    parameters: Library.LibraryProfileReadinessRequest,
    success: Library.LibraryProfileReadiness,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_binding_resolve", {
    description:
      "Verify a proposed immutable conversation computer, working copy, component scope and context. Does not run an agent.",
    parameters: Library.LibraryResolveBindingRequest,
    success: Library.LibraryResolvedBinding,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_thread_bind", {
    description:
      "Bind a newly created empty conversation to its reviewed computer, copy and project context. Existing bindings are immutable. A conversation that already has work in a borrowed folder's own project is saved instead: the Library keeps its history while it keeps running where it started, and loom_library_history_flush uploads it now. Use a linked new conversation for another computer.",
    parameters: Schema.Struct({
      threadId: ThreadId,
      binding: Library.LibraryThreadBinding,
      project: Schema.optional(Library.LibraryProject),
    }),
    success: Library.LibraryResolvedBinding,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_library_brief_propose", {
    description: `Propose a full replacement project brief with a short summary of why. A person reviews it in the Library and accepts, edits or dismisses it; agents cannot accept. A new proposal replaces this conversation's earlier pending one. A project holds at most ${MAX_PENDING_BRIEF_PROPOSALS} pending proposals; at that limit new ones fail as blocked, so wait for a person to review the queue rather than retrying.`,
    parameters: Library.LibraryProposeBriefRequest,
    success: Library.LibraryBriefProposal,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_library_brief_proposals", {
    description:
      "List a project's brief proposals, newest first, optionally by status: pending, accepted, dismissed or superseded.",
    parameters: Library.LibraryBriefProposalsRequest,
    success: Library.LibraryBriefProposalPage,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_history_flush", {
    description:
      "Upload the latest committed snapshot of every bound or saved conversation and its referenced assets from this computer now, without waiting for snapshot spacing. Conversations from before their folder started saving upload one at a time in the background; loom_library_thread_bind moves one into this upload. Pass threadIds to report only those conversations. A conversation too large for the upload outbox keeps waiting and fails the call as storage-limit after the others upload. Never retries an ambiguous provider dispatch.",
    parameters: Library.LibraryReplicationStatusRequest,
    success: Library.LibraryReplicationStatus,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
);
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
        projectOperationId(input.requestId, "create")
          .pipe(Effect.flatMap((id) => operate(id, { kind: "create", input })))
          .pipe(
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
        projectOperationId(input.requestId, "prepare")
          .pipe(Effect.flatMap((id) => operate(id, { kind: "prepare", input })))
          .pipe(
            Effect.flatMap((operation) => decodeOperationCopy(operation.result)),
            Effect.mapError((cause) =>
              isLibraryFailure(cause) ? cause : new Library.LibraryError({ reason: "io" }),
            ),
          ),
      ),
      loom_library_copy_retention: McpToolAccess.writesEnvironment((input) =>
        onHost(
          Effect.flatMap(Workspace.LibraryWorkspace, (service) => service.setCopyRetention(input)),
        ),
      ),
      loom_library_copy_reopen: McpToolAccess.writesEnvironment((input) =>
        projectOperationId(input.requestId, "reopen")
          .pipe(Effect.flatMap((id) => operate(id, { kind: "reopen", input })))
          .pipe(
            Effect.flatMap((operation) => decodeOperationCopy(operation.result)),
            Effect.mapError((cause) =>
              isLibraryFailure(cause) ? cause : new Library.LibraryError({ reason: "io" }),
            ),
          ),
      ),
      loom_library_copy_snapshot: McpToolAccess.writesEnvironment((input) =>
        projectOperationId(input.requestId, "snapshot")
          .pipe(Effect.flatMap((id) => operate(id, { kind: "snapshot", input })))
          .pipe(
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
        projectOperationId(input.requestId, "restore")
          .pipe(Effect.flatMap((id) => operate(id, { kind: "restore", input })))
          .pipe(
            Effect.flatMap((operation) => decodeOperationCopy(operation.result)),
            Effect.mapError((cause) =>
              isLibraryFailure(cause) ? cause : new Library.LibraryError({ reason: "io" }),
            ),
          ),
      ),
      loom_library_copy_release: McpToolAccess.writesEnvironment((input) =>
        projectOperationId(input.requestId, "release")
          .pipe(Effect.flatMap((id) => operate(id, { kind: "release", input })))
          .pipe(
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
