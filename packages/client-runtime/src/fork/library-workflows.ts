import type {
  LibraryOperation,
  LibraryPreservationEntry,
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
  LibraryWorkstream,
  LibraryWorkstreamReference,
} from "@t3tools/contracts/fork";

/** Tones every client maps to its own badge colors, so one state reads the same everywhere. */
export type LibraryWorkflowTone = "neutral" | "active" | "success" | "warning" | "danger";

export const LIBRARY_OPERATION_LABELS: Record<LibraryOperation["kind"], string> = {
  create: "Create project",
  prepare: "Prepare files",
  restore: "Restore files",
  reopen: "Reopen files",
  snapshot: "Save recovery archive",
  release: "Remove files",
  unregister: "Forget folder",
  launch: "Start conversation",
};

export const LIBRARY_OPERATION_STATES: Record<
  LibraryOperation["state"],
  { readonly label: string; readonly tone: LibraryWorkflowTone }
> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "active" },
  succeeded: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  "needs-input": { label: "Needs you", tone: "warning" },
};

/** Operations a person can still resume or cancel. Finished ones are history. */
export const libraryOperationNeedsAction = (operation: Pick<LibraryOperation, "state">) =>
  operation.state === "failed" || operation.state === "needs-input" || operation.state === "queued";

/** Unfinished operations first, then newest, so the list leads with what can still change. */
export function sortLibraryOperations(operations: readonly LibraryOperation[]) {
  return [...operations].sort(
    (a, b) =>
      Number(libraryOperationNeedsAction(b) || b.state === "running") -
        Number(libraryOperationNeedsAction(a) || a.state === "running") ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
}

export const LIBRARY_WORKSTREAM_STATES: Record<
  LibraryWorkstream["state"],
  { readonly label: string; readonly tone: LibraryWorkflowTone }
> = {
  active: { label: "Active", tone: "active" },
  completed: { label: "Completed", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
};

export const LIBRARY_WORKSTREAM_REFERENCE_KINDS: Record<
  LibraryWorkstreamReference["kind"],
  string
> = {
  thread: "Conversation",
  copy: "Files",
  repository: "Repository",
  branch: "Branch",
  "pull-request": "Pull request",
  verification: "Check",
};

/** The references a person adds by typing, in the order the editor offers them. */
export const LIBRARY_WORKSTREAM_TYPED_KINDS = ["verification", "branch", "pull-request"] as const;

export const LIBRARY_WORKSTREAM_REFERENCE_STATES: Record<
  LibraryWorkstreamReference["state"],
  { readonly label: string; readonly tone: LibraryWorkflowTone }
> = {
  open: { label: "Open", tone: "neutral" },
  passed: { label: "Passed", tone: "success" },
  completed: { label: "Done", tone: "success" },
  blocked: { label: "Blocked", tone: "danger" },
};

export const LIBRARY_WORKSTREAM_REFERENCE_STATE_ORDER = [
  "open",
  "passed",
  "completed",
  "blocked",
] as const;

export const isWorkstreamReferenceDone = (reference: Pick<LibraryWorkstreamReference, "state">) =>
  reference.state === "passed" || reference.state === "completed";

/** A check passes; anything else completes. */
export const workstreamReferenceDoneState = (
  reference: Pick<LibraryWorkstreamReference, "kind">,
): LibraryWorkstreamReference["state"] =>
  reference.kind === "verification" ? "passed" : "completed";

export function workstreamProgress(stream: Pick<LibraryWorkstream, "references">) {
  return {
    done: stream.references.filter(isWorkstreamReferenceDone).length,
    blocked: stream.references.filter((reference) => reference.state === "blocked").length,
    total: stream.references.length,
  };
}

export const workstreamReferenceKey = (
  reference: Pick<LibraryWorkstreamReference, "kind" | "id" | "environmentId">,
) => `${reference.kind}:${reference.environmentId ?? ""}:${reference.id}`;

/** Existing project work a workstream can link: its conversations, files and repositories. */
export function workstreamLinkOptions(
  project: Pick<LibraryProject, "resources">,
  threads: readonly LibraryThreadSummary[],
  copies: readonly LibraryWorkingCopy[],
): LibraryWorkstreamReference[] {
  return [
    ...threads
      .filter((thread) => !thread.deleted)
      .map((thread) => ({
        kind: "thread" as const,
        id: thread.threadId,
        environmentId: thread.environmentId,
        label: thread.title,
        state: thread.settled ? ("completed" as const) : ("open" as const),
      })),
    ...copies
      .filter((copy) => copy.state !== "released" && copy.registered !== false)
      .map((copy) => ({
        kind: "copy" as const,
        id: copy.id,
        environmentId: copy.environmentId,
        label: copy.rootPath.slice(-160),
        state: "open" as const,
      })),
    ...project.resources
      .filter((resource) => resource.kind !== "link")
      .map((resource) => ({
        kind: "repository" as const,
        id: resource.id,
        label: resource.title,
        state: "open" as const,
      })),
  ];
}

/** Finds the saved conversation a thread reference points at, by native or Library id. */
export function workstreamReferenceThread(
  reference: Pick<LibraryWorkstreamReference, "kind" | "id" | "environmentId">,
  threads: readonly LibraryThreadSummary[],
) {
  if (reference.kind !== "thread") return undefined;
  return threads.find(
    (thread) =>
      (thread.threadId === reference.id || thread.id === reference.id) &&
      (!reference.environmentId || thread.environmentId === reference.environmentId),
  );
}

/** Active work first, then finished, with archived kept last. Newest first within each. */
export function sortWorkstreams(streams: readonly LibraryWorkstream[]) {
  const rank = { active: 0, completed: 1, archived: 2 } as const;
  return [...streams].sort(
    (a, b) => rank[a.state] - rank[b.state] || b.updatedAt.localeCompare(a.updatedAt),
  );
}

export const LIBRARY_RESTORE_PATHS: Record<
  LibraryPreservationEntry["restore"],
  { readonly label: string; readonly detail: string; readonly tone: LibraryWorkflowTone }
> = {
  "verified-archive": {
    label: "Recovery archive saved",
    detail: "Everything on this computer can be restored, including local-only files.",
    tone: "success",
  },
  repository: {
    label: "Repository only",
    detail: "A fresh clone restores committed work. Local-only files are not covered.",
    tone: "warning",
  },
  unverified: {
    label: "No verified restore",
    detail: "Save a recovery archive before removing these files.",
    tone: "danger",
  },
};
