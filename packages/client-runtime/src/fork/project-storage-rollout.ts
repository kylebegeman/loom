import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type {
  ProjectCheckoutAdoptRequest,
  ProjectCheckoutPreview,
  ProjectCheckoutRetention,
  ProjectCheckoutRetentionRequest,
} from "@t3tools/contracts/fork";

export interface ProjectStorageRolloutTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly projectName: string;
  readonly environmentLabel: string;
  readonly connected: boolean;
  readonly supported: boolean;
  readonly canRead: boolean;
  readonly canAdopt: boolean;
  readonly canSetRetention: boolean;
  /** Connection, capability and permission context; exclude display-only labels. */
  readonly reviewContext?: string | undefined;
}

export interface ProjectStorageRolloutRow {
  readonly key: string;
  readonly target: ProjectStorageRolloutTarget;
  readonly selected: boolean;
  readonly status: "idle" | "reviewing" | "reviewed" | "saving" | "saved" | "error";
  readonly preview: ProjectCheckoutPreview | null;
  readonly choice: ProjectCheckoutRetention | null;
  readonly error: string | null;
  readonly result: ProjectCheckoutPreview | null;
}

export type ProjectStorageRolloutPlanEntry = {
  readonly key: string;
  readonly target: ProjectStorageRolloutTarget;
  readonly choice: ProjectCheckoutRetention;
  readonly preview: ProjectCheckoutPreview;
} & (
  | { readonly operation: "adopt"; readonly input: ProjectCheckoutAdoptRequest }
  | { readonly operation: "setRetention"; readonly input: ProjectCheckoutRetentionRequest }
);
export interface ProjectStorageRolloutPlan {
  readonly entries: ReadonlyArray<ProjectStorageRolloutPlanEntry>;
}
export interface ProjectStorageRolloutSnapshot {
  readonly phase: "idle" | "reviewing" | "confirming" | "saving" | "results";
  readonly rows: ReadonlyArray<ProjectStorageRolloutRow>;
  readonly confirmation: ProjectStorageRolloutPlan | null;
  readonly cancelRequested: boolean;
}
export interface ProjectStorageRolloutOperations {
  readonly preview: (target: ProjectStorageRolloutTarget) => Promise<ProjectCheckoutPreview>;
  readonly adopt: (
    target: ProjectStorageRolloutTarget,
    input: ProjectCheckoutAdoptRequest,
  ) => Promise<ProjectCheckoutPreview>;
  readonly setRetention: (
    target: ProjectStorageRolloutTarget,
    input: ProjectCheckoutRetentionRequest,
  ) => Promise<ProjectCheckoutPreview>;
}

export const PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS = {
  keep: "Keep on this computer",
  "release-on-settle": "Release when settled",
  inherit: "Use this computer's cleanup rules",
} satisfies Record<ProjectCheckoutRetention, string>;
export const PROJECT_STORAGE_ROLLOUT_CONFIRMATION_NOTICE =
  "Saving may immediately release a settled eligible working copy. Loom checks release safety separately; this review does not guarantee a folder can be released. Threads and history stay available. Choosing Keep for a released checkout may restore its working copy.";

export function projectStorageRolloutKey(target: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
}): string {
  return JSON.stringify([target.environmentId, target.projectId, target.workspaceRoot]);
}

/** Repeated computer names carry just enough environment identity to distinguish reviewed folders. */
export function projectStorageRolloutComputerLabels(
  labels: ReadonlyMap<EnvironmentId, string>,
): ReadonlyMap<EnvironmentId, string> {
  const named = new Map<string, EnvironmentId[]>();
  for (const [environmentId, name] of labels) {
    const peers = named.get(name) ?? [];
    peers.push(environmentId);
    named.set(name, peers);
  }
  return new Map(
    [...labels].map(([environmentId, name]) => {
      const peers = named.get(name)!;
      if (peers.length === 1) return [environmentId, name];
      let length = 8;
      while (
        length < environmentId.length &&
        peers.some(
          (peer) =>
            peer !== environmentId && peer.slice(0, length) === environmentId.slice(0, length),
        )
      )
        length++;
      return [environmentId, `${name} (${environmentId.slice(0, length)})`];
    }),
  );
}

export function projectStorageRolloutTargetReason(
  target: ProjectStorageRolloutTarget,
): string | null {
  if (!target.connected) return "Connect this computer to review its folder.";
  if (!target.supported) return "Update Loom on this computer to review project storage.";
  if (!target.canRead) return "This connection cannot review project folders on this computer.";
  return null;
}
export function canReviewProjectStorageTarget(target: ProjectStorageRolloutTarget): boolean {
  return projectStorageRolloutTargetReason(target) === null;
}
export function projectStorageRolloutChoices(
  row: ProjectStorageRolloutRow,
): ReadonlyArray<ProjectCheckoutRetention> {
  const { preview, target } = row;
  if (!canReviewProjectStorageTarget(target) || row.status !== "reviewed" || !preview?.reviewToken)
    return [];
  if (preview.state === "external" && target.canAdopt) return ["keep", "release-on-settle"];
  if ((preview.state === "managed" || preview.state === "released") && target.canSetRetention)
    return ["keep", "release-on-settle", "inherit"];
  return [];
}
export function projectStorageRolloutStateLabel(preview: ProjectCheckoutPreview): string {
  switch (preview.state) {
    case "external":
      return "Folder opened outside Loom";
    case "managed":
      return preview.ownershipSource === "adopted" ? "Managed folder" : "Managed clone";
    case "released":
      return "Working copy released";
    case "blocked":
      return "Needs attention";
  }
}
export function projectStorageRolloutLocalFilesLabel(preview: ProjectCheckoutPreview): string {
  const files = preview.localFiles;
  return `${files.trackedChanges} tracked ${files.trackedChanges === 1 ? "change" : "changes"}, ${files.untrackedFiles} untracked ${files.untrackedFiles === 1 ? "file" : "files"}, ${files.ignoredFiles} ignored ${files.ignoredFiles === 1 ? "file" : "files"}${files.truncated ? " (partial count)" : ""}`;
}

function sameAccess(a: ProjectStorageRolloutTarget, b: ProjectStorageRolloutTarget): boolean {
  return (
    a.reviewContext === b.reviewContext &&
    a.connected === b.connected &&
    a.supported === b.supported &&
    a.canRead === b.canRead &&
    a.canAdopt === b.canAdopt &&
    a.canSetRetention === b.canSetRetention
  );
}
function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error)
    return String(error.message);
  return "This request could not be completed. Review the folder again before retrying.";
}
function immutablePreview(preview: ProjectCheckoutPreview): ProjectCheckoutPreview {
  return Object.freeze({
    ...preview,
    localFiles: Object.freeze({ ...preview.localFiles }),
    blockers: Object.freeze([...preview.blockers]),
    repositoryIdentity: preview.repositoryIdentity
      ? Object.freeze({
          ...preview.repositoryIdentity,
          locator: Object.freeze({ ...preview.repositoryIdentity.locator }),
          ...(preview.repositoryIdentity.origin
            ? { origin: Object.freeze({ ...preview.repositoryIdentity.origin }) }
            : {}),
        })
      : null,
  });
}
function matchesTarget(
  preview: ProjectCheckoutPreview,
  target: ProjectStorageRolloutTarget,
): boolean {
  return preview.projectId === target.projectId && preview.workspaceRoot === target.workspaceRoot;
}

/** Reviews only explicitly selected known folders. The existing guarded RPCs remain authoritative. */
export function createProjectStorageRolloutController(operations: ProjectStorageRolloutOperations) {
  let snapshot: ProjectStorageRolloutSnapshot = Object.freeze({
    phase: "idle",
    rows: Object.freeze([]),
    confirmation: null,
    cancelRequested: false,
  });
  let disposed = false;
  let revision = 0;
  let operation = 0;
  let inFlightSave: string | null = null;
  const versions = new Map<string, number>();
  const listeners = new Set<() => void>();
  const busy = () => snapshot.phase === "reviewing" || snapshot.phase === "saving";
  const publish = (next: ProjectStorageRolloutSnapshot) => {
    snapshot = Object.freeze({
      ...next,
      rows: Object.freeze(next.rows.map((row) => Object.freeze(row))),
    });
    if (!disposed) for (const listener of listeners) listener();
  };
  const updateRow = (key: string, changes: Partial<ProjectStorageRolloutRow>) => {
    publish({
      ...snapshot,
      rows: snapshot.rows.map((row) => (row.key === key ? { ...row, ...changes } : row)),
    });
  };
  const clearPlan = () => {
    revision += 1;
    publish({
      ...snapshot,
      confirmation: null,
      phase: snapshot.phase === "confirming" ? "idle" : snapshot.phase,
    });
  };
  const find = (key: string) => snapshot.rows.find((row) => row.key === key);

  const controller = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    syncTargets: (targets: ReadonlyArray<ProjectStorageRolloutTarget>) => {
      if (disposed) return;
      const byKey = new Map(targets.map((target) => [projectStorageRolloutKey(target), target]));
      let invalidated = false;
      const rows = snapshot.rows.flatMap((row): ProjectStorageRolloutRow[] => {
        const target = byKey.get(row.key);
        byKey.delete(row.key);
        if (!target) {
          if (row.status === "saved") return [row];
          invalidated = true;
          versions.set(row.key, (versions.get(row.key) ?? 0) + 1);
          if (row.key === inFlightSave)
            return [{ ...row, target: Object.freeze({ ...row.target, connected: false }) }];
          return [];
        }
        const nextTarget = Object.freeze({ ...target });
        if (!sameAccess(row.target, target) && row.status !== "saved") {
          invalidated = true;
          versions.set(row.key, (versions.get(row.key) ?? 0) + 1);
          return [
            {
              ...row,
              target: nextTarget,
              preview: null,
              choice: null,
              error: null,
              status: row.key === inFlightSave ? "saving" : "idle",
            },
          ];
        }
        return [{ ...row, target: nextTarget }];
      });
      for (const [key, target] of byKey) {
        invalidated = true;
        versions.set(key, (versions.get(key) ?? 0) + 1);
        rows.push({
          key,
          target: Object.freeze({ ...target }),
          selected: false,
          status: "idle",
          preview: null,
          choice: null,
          error: null,
          result: null,
        });
      }
      if (invalidated) revision += 1;
      publish({
        ...snapshot,
        rows,
        confirmation: invalidated ? null : snapshot.confirmation,
        phase: invalidated && snapshot.phase === "confirming" ? "idle" : snapshot.phase,
      });
    },
    setSelected: (key: string, selected: boolean) => {
      const row = find(key);
      if (disposed || busy() || !row || row.status === "saved" || row.selected === selected) return;
      clearPlan();
      updateRow(key, { selected });
    },
    choose: (key: string, choice: ProjectCheckoutRetention) => {
      const row = find(key);
      if (
        disposed ||
        busy() ||
        !row ||
        !row.selected ||
        !projectStorageRolloutChoices(row).includes(choice)
      )
        return;
      clearPlan();
      updateRow(key, { choice });
    },
    review: async (keys?: ReadonlyArray<string>) => {
      if (disposed || busy()) return;
      const requested = keys ? new Set(keys) : null;
      const queue = snapshot.rows.filter(
        (row) => row.selected && row.status !== "saved" && (!requested || requested.has(row.key)),
      );
      if (queue.length === 0) return;
      clearPlan();
      const currentOperation = ++operation;
      publish({ ...snapshot, phase: "reviewing", cancelRequested: false });
      for (const queued of queue) {
        if (disposed || snapshot.cancelRequested || currentOperation !== operation) break;
        const row = find(queued.key);
        if (!row || !row.selected || row.status === "saved") continue;
        const reason = projectStorageRolloutTargetReason(row.target);
        if (reason) {
          updateRow(row.key, { status: "error", preview: null, choice: null, error: reason });
          continue;
        }
        const version = versions.get(row.key);
        updateRow(row.key, { status: "reviewing", preview: null, choice: null, error: null });
        try {
          const preview = await operations.preview(row.target);
          if (disposed || snapshot.cancelRequested || currentOperation !== operation) break;
          const current = find(row.key);
          if (!current || versions.get(row.key) !== version) continue;
          if (!matchesTarget(preview, current.target))
            throw new Error(
              "This folder changed since selection. Review the current folder again.",
            );
          updateRow(row.key, {
            status: "reviewed",
            preview: immutablePreview(preview),
            choice: null,
          });
        } catch (error) {
          if (!disposed && !snapshot.cancelRequested && versions.get(row.key) === version)
            updateRow(row.key, {
              status: "error",
              preview: null,
              choice: null,
              error: message(error),
            });
        }
      }
      if (!disposed && currentOperation === operation)
        publish({
          ...snapshot,
          phase: "idle",
          rows: snapshot.rows.map((row) =>
            row.status === "reviewing" ? { ...row, status: "idle" } : row,
          ),
        });
    },
    confirm: (): ProjectStorageRolloutPlan | null => {
      if (disposed || busy()) return null;
      const rows = snapshot.rows.filter((row) => row.selected && row.status !== "saved");
      if (
        rows.length === 0 ||
        rows.some((row) => !row.choice || !projectStorageRolloutChoices(row).includes(row.choice))
      )
        return null;
      const entries = rows.map((row): ProjectStorageRolloutPlanEntry => {
        const input = Object.freeze({
          projectId: row.target.projectId,
          reviewToken: row.preview!.reviewToken!,
          retention: row.choice!,
        });
        const shared = {
          key: row.key,
          target: row.target,
          choice: row.choice!,
          preview: row.preview!,
        };
        return row.preview!.state === "external"
          ? Object.freeze({
              ...shared,
              operation: "adopt",
              input: Object.freeze({
                ...input,
                retention: row.choice === "release-on-settle" ? row.choice : "keep",
              }),
            })
          : Object.freeze({ ...shared, operation: "setRetention", input });
      });
      const plan = Object.freeze({ entries: Object.freeze(entries) });
      publish({ ...snapshot, phase: "confirming", confirmation: plan });
      return plan;
    },
    cancelConfirmation: () => {
      if (disposed || snapshot.phase !== "confirming") return;
      clearPlan();
    },
    save: async (plan: ProjectStorageRolloutPlan) => {
      if (disposed || busy() || snapshot.phase !== "confirming" || snapshot.confirmation !== plan)
        return;
      const planRevision = revision;
      const currentOperation = ++operation;
      publish({ ...snapshot, phase: "saving", confirmation: null, cancelRequested: false });
      for (const entry of plan.entries) {
        if (
          disposed ||
          snapshot.cancelRequested ||
          currentOperation !== operation ||
          revision !== planRevision
        )
          break;
        const row = find(entry.key);
        if (
          !row ||
          row.choice !== entry.choice ||
          row.preview?.reviewToken !== entry.input.reviewToken ||
          !projectStorageRolloutChoices(row).includes(entry.choice)
        )
          break;
        inFlightSave = row.key;
        updateRow(row.key, { status: "saving", error: null });
        try {
          const result = await (entry.operation === "adopt"
            ? operations.adopt(entry.target, entry.input)
            : operations.setRetention(entry.target, entry.input));
          if (!matchesTarget(result, entry.target))
            throw new Error(
              "The response identified a different folder. Review this folder again before retrying.",
            );
          // An issued mutation can finish after cancellation or an access change. Preserve that result.
          if (find(entry.key))
            updateRow(entry.key, {
              status: "saved",
              preview: null,
              choice: null,
              error: null,
              result: immutablePreview(result),
            });
        } catch (error) {
          if (find(entry.key))
            updateRow(entry.key, {
              status: "error",
              preview: null,
              choice: null,
              error: message(error),
            });
        } finally {
          inFlightSave = null;
        }
      }
      if (!disposed && currentOperation === operation)
        publish({ ...snapshot, phase: "results", confirmation: null });
    },
    cancel: () => {
      if (disposed || !busy()) return;
      publish({ ...snapshot, cancelRequested: true });
    },
    dispose: () => {
      disposed = true;
      listeners.clear();
    },
  };
  return controller;
}
export type ProjectStorageRolloutController = ReturnType<
  typeof createProjectStorageRolloutController
>;
