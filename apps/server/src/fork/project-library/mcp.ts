import { OrchestratorMcpFailure, ThreadId } from "@t3tools/contracts";
import * as Library from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { MAX_PENDING_BRIEF_PROPOSALS } from "./LibraryBriefProposals.ts";
import * as BriefSuggestions from "./LibraryBriefSuggestions.ts";
import * as Catalog from "./LibraryService.ts";
import * as Timeline from "./LibraryTimeline.ts";
import * as Launch from "./LibraryLaunchCandidates.ts";
import * as Workspace from "./LibraryWorkspace.ts";
import * as Replication from "./LibraryReplication.ts";

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
export const ProjectLibraryToolkit = Toolkit.make(
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
      "Read a project's centrally saved conversation index with source computer and saved watermark.",
    parameters: Schema.Struct({ projectId: Library.LibraryId }),
    success: Schema.Array(Library.LibraryThreadSummary),
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
  Tool.make("loom_library_thread_index", {
    description:
      "Read a bounded page of centrally saved conversations across projects without opening full history.",
    parameters: Schema.Struct({
      offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
      limit: Schema.optional(
        Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)),
      ),
    }),
    success: Library.LibraryThreadIndex,
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
    success: Schema.NullOr(Library.LibraryProject),
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_library_thread_binding", {
    description:
      "Read the immutable project, scope and working-copy binding of an existing conversation on this computer.",
    parameters: Schema.Struct({ threadId: ThreadId }),
    success: Schema.NullOr(Library.LibraryThreadBinding),
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
    success: Library.LibraryThreadArchive,
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
      "Reuse an existing folder or clone all selected project repositories beneath one parent on this computer. Prefer reuse. Retry with the same requestId after a failure.",
    parameters: Library.LibraryPrepareCopyRequest,
    success: Library.LibraryWorkingCopy,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_library_copy_status", {
    description:
      "Review working-copy ownership, active bindings, cleanup blockers and each repository's branch, ahead/behind counts and uncommitted files. A current reviewToken is needed to release.",
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
      "Bind a newly created empty conversation to its reviewed computer, copy and project context. Existing bindings are immutable. Use a linked new conversation for another computer.",
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
      "Upload committed bound conversation snapshots and referenced assets from this computer. Never retries an ambiguous provider dispatch.",
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

export const projectLibraryHandlers = McpToolAccess.toLayer(
  ProjectLibraryToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_library_projects: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(Catalog.LibraryService, (service) =>
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
        onHost(Effect.flatMap(Catalog.LibraryService, (service) => service.threads(input))),
      ),
      loom_library_lookup_thread: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(Catalog.LibraryService, (service) => service.lookupThread(input))),
      ),
      loom_library_thread_index: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(Catalog.LibraryService, (service) => service.threadIndex(input))),
      ),
      loom_library_connection: McpToolAccess.reads(() =>
        onHost(Effect.flatMap(Catalog.LibraryService, (service) => service.info)),
      ),
      loom_library_bound_project: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(Workspace.LibraryWorkspace, (service) => service.threadProject(input)),
        ),
      ),
      loom_library_thread_binding: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(Workspace.LibraryWorkspace, (service) => service.threadBinding(input)),
        ),
      ),
      loom_library_history: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(Catalog.LibraryService, (service) =>
            service.history({ ...input, offset: input.offset ?? 0, limit: input.limit ?? 50 }),
          ),
        ),
      ),
      loom_library_search: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(Catalog.LibraryService, (service) =>
            service.search({ ...input, limit: input.limit ?? 20 }),
          ),
        ),
      ),
      loom_library_timeline: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(Timeline.LibraryTimeline, (service) => service.page(input))),
      ),
      loom_library_launch_candidates: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(Launch.LibraryLaunchCandidates, (service) => service.candidates(input)),
        ),
      ),
      loom_library_project_create: McpToolAccess.writesEnvironment((input) =>
        onHost(Effect.flatMap(Catalog.LibraryService, (service) => service.createProject(input))),
      ),
      loom_library_project_update: McpToolAccess.writesEnvironment((input) =>
        onHost(Effect.flatMap(Catalog.LibraryService, (service) => service.updateProject(input))),
      ),
      loom_library_project_archive: McpToolAccess.writesEnvironment((input) =>
        onHost(Effect.flatMap(Catalog.LibraryService, (service) => service.archiveProject(input))),
      ),
      loom_library_copy_prepare: McpToolAccess.writesEnvironment((input) =>
        onHost(Effect.flatMap(Workspace.LibraryWorkspace, (service) => service.prepareCopy(input))),
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
      loom_library_history_flush: McpToolAccess.writesEnvironment(() =>
        onHost(
          Effect.flatMap(Replication.LibraryReplication, (service) =>
            service.drain.pipe(Effect.andThen(service.status)),
          ),
        ),
      ),
    };
  }),
);
