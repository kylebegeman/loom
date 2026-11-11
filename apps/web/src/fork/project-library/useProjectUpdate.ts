import {
  validateResources,
  squashLibraryCommandFailure,
  libraryAccessRepairFromFailure,
} from "@t3tools/client-runtime/fork";
import * as Schema from "effect/Schema";
import { useEffect, useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LibraryError,
  LibraryUpdateProjectRequest,
  LibraryProject,
  type LibraryProjectColor,
  type LibraryProjectProfileInput,
} from "@t3tools/contracts/fork";
import { randomUUID } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";
import { projectLibrary, useLibraryPermission } from "./state";
import { useEnvironmentSessionState } from "~/state/session";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useLibraryAttempt } from "./attempts";

const isProject = Schema.is(LibraryProject);
const UpdateAttempt = Schema.Struct({
  fingerprint: Schema.String,
  input: LibraryUpdateProjectRequest,
  state: Schema.Literals(["unknown", "ready"]),
  initiator: Schema.optionalKey(Schema.Struct({ issuer: Schema.String, subject: Schema.String })),
});

type ProjectChange = Partial<
  Pick<LibraryProject, "title" | "brief" | "resources" | "dependencies">
> & {
  /** Null returns the project to its automatic color. */
  readonly color?: LibraryProjectColor | null;
  /** Null removes the profile. */
  readonly profile?: LibraryProjectProfileInput | null;
};

/**
 * Saves one in-place edit against the revision on screen. A conflict reports and refreshes
 * rather than overwriting someone else's change, so each edit stays small and retryable.
 */
export function useProjectUpdate({
  project,
  authorityId,
  connected,
  onSaved,
}: {
  readonly project: LibraryProject;
  readonly authorityId: EnvironmentId | null;
  readonly connected: boolean;
  readonly onSaved: () => void;
}) {
  const update = useAtomCommand(projectLibrary.updateProject, { reportFailure: false });
  const outcome = useAtomCommand(projectLibrary.operationOutcome, { reportFailure: false });
  const allowed = useLibraryPermission(projectLibrary.updateProject, authorityId);
  const canReadOutcome = useLibraryPermission(projectLibrary.operationOutcome, authorityId);
  const identity = useEnvironmentSessionState(authorityId).data?.identity;
  const [pending, saveAttempt, unreadable] = useLibraryAttempt(
    `loom:library:update:${authorityId}:${project.id}`,
    UpdateAttempt,
  );
  const saving = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repair, setRepair] = useState<ReturnType<typeof libraryAccessRepairFromFailure>>();
  const accountMatches =
    !pending?.initiator ||
    (pending.initiator.issuer === identity?.issuer &&
      pending.initiator.subject === identity?.subject);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- guards callbacks after this editor unmounts while retaining the durable request
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = useStableCallback(
    (environmentId: EnvironmentId, projectId: string, input: typeof UpdateAttempt.Type) =>
      mounted.current &&
      authorityId === environmentId &&
      project.id === projectId &&
      (!input.initiator ||
        (input.initiator.issuer === identity?.issuer &&
          input.initiator.subject === identity?.subject)),
  );
  const canEdit = allowed && connected && !project.archived;
  const needsRecovery = pending?.state === "unknown";
  const perform = async (attempt: typeof UpdateAttempt.Type, check: boolean) => {
    if (!authorityId || unreadable || saving.current) return false;
    if (!accountMatches) {
      setError("Sign in with the account that started this update before continuing.");
      return false;
    }
    if (!connected || (check ? !canReadOutcome : !canEdit)) return false;
    saving.current = true;
    setBusy(true);
    setError(null);
    setRepair(undefined);
    const input = attempt.input;
    const onlyOriginal = (latest: typeof UpdateAttempt.Type | null) =>
      latest?.input.requestId === input.requestId;
    const run = async () => {
      if (check) {
        const answer = await outcome({
          environmentId: authorityId,
          input: { requestId: input.requestId, kind: "update" },
        });
        if (answer._tag === "Failure") throw squashLibraryCommandFailure(answer);
        const operation = answer.value;
        if (
          operation &&
          (operation.kind !== "update" ||
            operation.environmentId !== authorityId ||
            operation.projectId !== input.projectId)
        )
          throw new Error("The receipt belongs to another project or computer.");
        if (operation?.state === "succeeded") {
          if (!isProject(operation.result) || operation.result.id !== input.projectId)
            throw new Error("The saved update did not return this project.");
          saveAttempt(null, onlyOriginal);
          if (!current(authorityId, input.projectId, attempt)) return false;
          onSaved();
          return true;
        }
        if (
          operation === null ||
          operation.state === "needs-input" ||
          operation.state === "failed"
        ) {
          saveAttempt({ ...attempt, state: "ready" }, onlyOriginal);
          if (current(authorityId, input.projectId, attempt)) {
            setRepair(operation?.accessRepair);
            setError(
              operation?.error ??
                "The saved update is ready for an explicit retry. Save again when you are ready.",
            );
          }
          return false;
        }
        throw new LibraryError({
          reason: "blocked",
          detail:
            operation.state === "cancelled"
              ? "This update was cancelled. Review its completed steps before starting another."
              : "This update is still running. Check its result again.",
          ...(operation.accessRepair ? { accessRepair: operation.accessRepair } : {}),
        });
      }
      saveAttempt({ ...attempt, state: "unknown" });
      const result = await update({ environmentId: authorityId, input });
      if (result._tag === "Failure") throw squashLibraryCommandFailure(result);
      saveAttempt(null, onlyOriginal);
      if (!current(authorityId, input.projectId, attempt)) return false;
      onSaved();
      return true;
    };
    return run()
      .catch((cause: unknown) => {
        if (current(authorityId, input.projectId, attempt)) {
          setRepair(libraryAccessRepairFromFailure(cause, authorityId));
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not save this change. Check the saved request before retrying.",
          );
          onSaved();
        }
        return false;
      })
      .finally(() => {
        saving.current = false;
        if (mounted.current) setBusy(false);
      });
  };
  const recover = () => (pending ? perform(pending, true) : Promise.resolve(false));
  const resume = () =>
    pending ? perform(pending, pending.state === "unknown") : Promise.resolve(false);
  const save = async (change: ProjectChange) => {
    if (!authorityId || unreadable || saving.current) return false;
    if (pending?.state === "unknown") return recover();
    if (!canEdit) return false;
    const next = {
      title: (change.title ?? project.title).trim(),
      brief: change.brief ?? project.brief,
      resources: change.resources ?? project.resources,
    };
    const invalid = !next.title
      ? "Give the project a name."
      : change.resources === undefined
        ? null
        : validateResources(change.resources);
    if (invalid) {
      setError(invalid);
      return false;
    }
    const fingerprint = JSON.stringify({ authorityId, projectId: project.id, change });
    if (pending && pending.fingerprint !== fingerprint) {
      setError("Resume the saved update before changing its details.");
      return false;
    }
    if (pending) return resume();
    const { resources, ...fields } = change;
    const patchResources =
      resources !== undefined &&
      resources.length === project.resources.length &&
      resources.every((resource, index) => {
        const saved = project.resources[index]!;
        return (
          resource.id === saved.id &&
          resource.kind === saved.kind &&
          !(resource.url === undefined && saved.url !== undefined)
        );
      });
    const resourceChange =
      resources === undefined
        ? {}
        : patchResources
          ? {
              resourceUpdates: resources.flatMap((resource, index) => {
                const saved = project.resources[index]!;
                const patch = {
                  id: resource.id,
                  ...(resource.title === saved.title ? {} : { title: resource.title }),
                  ...(resource.remoteUrl === saved.remoteUrl
                    ? {}
                    : { remoteUrl: resource.remoteUrl }),
                  ...(resource.relativePath === saved.relativePath
                    ? {}
                    : { relativePath: resource.relativePath }),
                  ...(resource.defaultBranch === saved.defaultBranch
                    ? {}
                    : { defaultBranch: resource.defaultBranch }),
                  ...(resource.url === saved.url || resource.url === undefined
                    ? {}
                    : { url: resource.url }),
                };
                return Object.keys(patch).length > 1 ? [patch] : [];
              }),
            }
          : { resources };
    const attempt: typeof UpdateAttempt.Type = {
      state: "unknown",
      ...(identity ? { initiator: identity } : {}),
      fingerprint,
      input: {
        requestId: randomUUID(),
        projectId: project.id,
        expectedRevision: project.revision,
        ...fields,
        ...resourceChange,
        ...(change.title === undefined ? {} : { title: next.title }),
      },
    };
    return perform(attempt, false);
  };
  return {
    save,
    recover,
    resume,
    busy,
    needsRecovery,
    hasPendingRequest: pending !== null,
    pendingInput: pending?.input ?? null,
    canRecover: pending !== null && connected && canReadOutcome && accountMatches,
    canResume: pending?.state === "ready" && canEdit && accountMatches,
    accessRepair: !accountMatches
      ? { kind: "ownership" as const, ...(authorityId ? { environmentId: authorityId } : {}) }
      : repair,
    accessContext: { environmentId: authorityId, originalAccount: pending?.initiator },
    error: unreadable
      ? "The saved update could not be read. Keep it for recovery before saving another change."
      : error,
    clearError: () => setError(null),
    canEdit: canEdit && !unreadable,
  };
}
