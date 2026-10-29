import { libraryLaunchRequirementsMet } from "@t3tools/shared/fork/library-launch";
import { type EnvironmentId, OrchestratorMcpFailure, type ProjectId } from "@t3tools/contracts";
import type { LibraryProject, LibraryThreadBinding } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Tool from "effect/ai/Tool";
import type { McpThreadInvocationScope } from "../../mcp/McpInvocationContext.ts";
import { ProjectToolkit } from "../../mcp/toolkits/project/tools.ts";
import * as PeerForwarding from "../../peer/PeerForwarding.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { ProjectLibraryToolkit } from "../project-library/tools.ts";
import * as LibraryPublisher from "../project-library/LibraryPublisher.ts";
import * as LibraryWorkspaceStore from "../project-library/LibraryWorkspaceStore.ts";

const failure = (message: string) =>
  new OrchestratorMcpFailure({ code: "target_required", message });

export interface LibraryRemotePlacement {
  readonly project: LibraryProject;
  readonly binding: LibraryThreadBinding;
  readonly projectId: ProjectId;
}

export const resolveLibraryRemotePlacement = Effect.fn("LibraryDelegation.resolvePlacement")(
  function* (
    scope: McpThreadInvocationScope,
    environmentId: EnvironmentId,
    requestedProjectId: ProjectId | undefined,
  ) {
    const store = yield* Effect.serviceOption(LibraryWorkspaceStore.LibraryWorkspaceStore);
    if (Option.isNone(store)) return null;
    const parent = yield* store.value
      .getBinding(scope.thread.threadId)
      .pipe(Effect.mapError(() => failure("Unable to read this conversation's Library binding.")));
    if (parent === null) return null;
    const project = yield* store.value
      .getBoundProject(scope.thread.threadId)
      .pipe(
        Effect.mapError(() =>
          failure("Unable to read this conversation's pinned Library project."),
        ),
      );
    if (project === null || project.archived || (yield* ForkRuntime) === undefined)
      return yield* failure(
        "The pinned Library project is unavailable. Reopen it before delegating.",
      );
    const listed = yield* withForkRuntime(
      Effect.flatMap(LibraryPublisher.LibraryPublisher, (publisher) =>
        publisher.launchCandidates({
          projectId: project.id,
          ...(parent.binding.resourceIds.length === 0
            ? {}
            : { resourceIds: [...parent.binding.resourceIds] }),
        }),
      ),
    ).pipe(
      Effect.mapError(() => failure("Unable to read this Library project's destination copies.")),
    );
    const candidates = listed.candidates.filter(
      (candidate) =>
        candidate.kind === "copy" &&
        candidate.environmentId === environmentId &&
        candidate.copyId !== undefined &&
        candidate.freshness !== "broken",
    );
    if (candidates.length === 0 || candidates.length > 32)
      return yield* failure(
        "Prepare a registered copy of this Library project on the chosen computer before delegating.",
      );
    const forwarding = yield* PeerForwarding.PeerForwarding;
    const matches: LibraryRemotePlacement[] = [];
    for (const candidate of candidates) {
      const binding = {
        projectId: parent.binding.projectId,
        projectRevision: parent.binding.projectRevision,
        resourceIds: [...parent.binding.resourceIds],
        environmentId,
        workingCopyId: candidate.copyId!,
      };
      const resolution = yield* forwarding
        .call(scope, ProjectLibraryToolkit.tools.loom_library_binding_resolve, environmentId, {
          project,
          binding,
        })
        .pipe(Effect.result);
      if (resolution._tag === "Failure") {
        if (requestedProjectId !== undefined) continue;
        return yield* resolution.failure;
      }
      const resolved = resolution.success;
      if (
        resolved.binding.projectId !== binding.projectId ||
        resolved.binding.projectRevision !== binding.projectRevision ||
        resolved.binding.environmentId !== environmentId ||
        resolved.binding.workingCopyId !== binding.workingCopyId ||
        resolved.binding.resourceIds.join("\0") !== binding.resourceIds.join("\0")
      )
        return yield* failure(
          "The destination returned a different Library project, copy or component scope.",
        );
      if (requestedProjectId === undefined || resolved.localProjectId === requestedProjectId)
        matches.push({ project, binding, projectId: resolved.localProjectId });
    }
    if (matches.length !== 1)
      return yield* failure(
        matches.length === 0
          ? "target.projectId does not identify this Library project's selected components on that computer. Choose its exact Library copy."
          : "Several Library copies match on that computer. Pass the exact destination target.projectId.",
      );
    const readiness = yield* forwarding.call(
      scope,
      ProjectLibraryToolkit.tools.loom_library_profile_readiness,
      environmentId,
      {
        projectId: project.id,
        ...(project.profile === undefined ? {} : { profile: project.profile }),
      },
    );
    if (
      readiness.projectId !== project.id ||
      readiness.environmentId !== environmentId ||
      readiness.checks.some((check) => check.status !== "ok") ||
      !libraryLaunchRequirementsMet(project.profile, readiness)
    )
      return yield* failure(
        "The chosen computer has not passed this Library project's required tool checks.",
      );
    return matches[0]!;
  },
);

type LaunchInput = Tool.Parameters<typeof ProjectToolkit.tools.t3_thread_launch>;

export const launchLibraryRemoteTask = Effect.fn("LibraryDelegation.launch")(function* (
  scope: McpThreadInvocationScope,
  environmentId: EnvironmentId,
  placement: LibraryRemotePlacement,
  input: LaunchInput & {
    readonly message: NonNullable<LaunchInput["message"]>;
    readonly clientRequestId: string;
  },
) {
  const forwarding = yield* PeerForwarding.PeerForwarding;
  // Borrowed copies may use an existing local project; bind before the first provider dispatch.
  const { message, ...emptyLaunch } = input;
  const launched = yield* forwarding.call(
    scope,
    ProjectToolkit.tools.t3_thread_launch,
    environmentId,
    emptyLaunch,
  );
  yield* forwarding.call(
    scope,
    ProjectLibraryToolkit.tools.loom_library_thread_bind,
    environmentId,
    {
      threadId: launched.threadId,
      project: placement.project,
      binding: placement.binding,
    },
  );
  // The toolkit depends on OrchestratorMcpService, which loads this adapter.
  const { OrchestratorToolkit } = yield* Effect.promise(
    () => import("../../mcp/toolkits/orchestrator/tools.ts"),
  );
  const sent = yield* forwarding.call(
    scope,
    OrchestratorToolkit.tools.t3_thread_send,
    environmentId,
    {
      threadId: launched.threadId,
      message,
      clientRequestId: `${input.clientRequestId}:message`,
    },
  );
  return { ...launched, runId: sent.runId, status: sent.status };
});
