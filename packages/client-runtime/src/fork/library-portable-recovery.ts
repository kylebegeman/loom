import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { libraryCopiesForScope } from "./library-copy-choice.ts";

export type LibraryPortableRecoveryPlan =
  | { readonly kind: "local"; readonly copy: LibraryWorkingCopy }
  | {
      readonly kind: "recover";
      readonly sourceCopy: LibraryWorkingCopy;
      readonly needsSnapshot: boolean;
    }
  | {
      readonly kind: "choose";
      readonly candidates: readonly LibraryWorkingCopy[];
      readonly reason: string;
    }
  | { readonly kind: "clone" }
  | { readonly kind: "unavailable"; readonly message: string };

const saved = (copy: LibraryWorkingCopy) =>
  copy.recovery !== undefined &&
  /^[a-f0-9]{64}$/.test(copy.recovery.sha256) &&
  Number.isSafeInteger(copy.recovery.byteLength) &&
  copy.recovery.byteLength > 0 &&
  Number.isFinite(Date.parse(copy.recovery.verifiedAt));

/** A source names files, so a missing source must never turn into an unrelated Git clone. */
export function libraryPortableRecoveryPlan(input: {
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly destinationEnvironmentId: EnvironmentId;
  readonly resourceIds: readonly string[] | null;
  readonly sourceWorkingCopyId?: string | null;
  readonly sourceEnvironmentId?: EnvironmentId | null;
  readonly selectedSourceCopyId?: string | null;
}): LibraryPortableRecoveryPlan {
  const unavailable = (message: string): LibraryPortableRecoveryPlan => ({
    kind: "unavailable",
    message,
  });
  const compatible = (copy: LibraryWorkingCopy) =>
    (input.resourceIds !== null ||
      copy.ownership !== "managed" ||
      copy.repositories.length ===
        input.project.resources.filter((resource) => resource.kind !== "link").length) &&
    libraryCopiesForScope(
      input.project,
      [{ ...copy, state: "ready", registered: true }],
      copy.environmentId,
      input.resourceIds,
    ).length === 1;
  if (input.project.archived) return unavailable("Restore this project before starting work.");
  const copies = input.copies.filter((copy) => copy.projectId === input.project.id);
  const usable = (copy: LibraryWorkingCopy) =>
    compatible(copy) &&
    ((copy.state === "ready" && copy.registered !== false) ||
      (copy.state === "released" && saved(copy)));
  const plan = (copy: LibraryWorkingCopy): LibraryPortableRecoveryPlan => {
    if (!usable(copy))
      return unavailable(
        "These project files are unavailable or no longer match the selected repositories. Review their original location before continuing.",
      );
    return copy.environmentId === input.destinationEnvironmentId
      ? { kind: "local", copy }
      : { kind: "recover", sourceCopy: copy, needsSnapshot: copy.state === "ready" };
  };
  const choose = (candidates: readonly LibraryWorkingCopy[]): LibraryPortableRecoveryPlan => ({
    kind: "choose",
    candidates,
    reason: "This project has files in more than one location. Choose which files to use.",
  });
  if (input.selectedSourceCopyId) {
    const selected = copies.filter((copy) => copy.id === input.selectedSourceCopyId);
    return selected.length === 1
      ? plan(selected[0]!)
      : unavailable("The selected files are no longer available. Choose their location again.");
  }
  if (input.sourceWorkingCopyId) {
    const source = copies.filter(
      (copy) =>
        copy.id === input.sourceWorkingCopyId &&
        (!input.sourceEnvironmentId || copy.environmentId === input.sourceEnvironmentId),
    );
    if (source.length !== 1)
      return unavailable(
        "The conversation's original files are unavailable. Review its project files before continuing.",
      );
    const sourceCopy = source[0]!;
    const sourcePlan = plan(sourceCopy);
    if (sourcePlan.kind === "unavailable" || sourcePlan.kind === "local") return sourcePlan;
    const local = copies.filter(
      (copy) => copy.environmentId === input.destinationEnvironmentId && usable(copy),
    );
    return local.length > 0 ? choose([sourceCopy, ...local]) : sourcePlan;
  }
  const local = copies.filter(
    (copy) => copy.environmentId === input.destinationEnvironmentId && usable(copy),
  );
  if (local.length === 1) return plan(local[0]!);
  if (local.length > 1) return choose(local);
  const sources = copies.filter(usable);
  if (sources.length === 1) return plan(sources[0]!);
  if (sources.length > 1) return choose(sources);
  if (copies.some((copy) => compatible(copy)))
    return unavailable(
      "The project's files need attention on their original computer before they can be used here.",
    );
  const repositories = input.project.resources.filter(
    (resource) =>
      resource.kind !== "link" &&
      (input.resourceIds === null || input.resourceIds.includes(resource.id)),
  );
  if (repositories.some((resource) => !resource.remoteUrl))
    return unavailable(
      "These files have not been saved for another computer yet. Save them from their original location first.",
    );
  return { kind: "clone" };
}
