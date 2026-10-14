import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const ProjectPreparationReceipt = Schema.Struct({
  sourceEnvironmentId: EnvironmentId,
  sourceProjectId: ProjectId,
  destinationEnvironmentId: EnvironmentId,
  projectId: ProjectId,
  title: Schema.String,
  createdAt: Schema.String,
  remoteUrl: Schema.String,
  repositoryKey: Schema.String,
  destinationPath: Schema.String,
});
export type ProjectPreparationReceipt = typeof ProjectPreparationReceipt.Type;
export const isProjectPreparationReceipt = Schema.is(ProjectPreparationReceipt);
export type ProjectPreparationReceipts = Readonly<Record<string, ProjectPreparationReceipt | null>>;

export function preparationReceiptKey(
  sourceEnvironmentId: EnvironmentId,
  sourceProjectId: ProjectId,
  destinationEnvironmentId: EnvironmentId,
): string {
  return JSON.stringify([sourceEnvironmentId, sourceProjectId, destinationEnvironmentId]);
}

/** Unreadable claims stay present, preventing an accidental new request after recovery. */
export function sanitizePreparationReceipts(
  value: unknown,
): ProjectPreparationReceipts | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).map(([key, receipt]) => [
      key,
      isProjectPreparationReceipt(receipt) &&
      key ===
        preparationReceiptKey(
          receipt.sourceEnvironmentId,
          receipt.sourceProjectId,
          receipt.destinationEnvironmentId,
        )
        ? receipt
        : null,
    ]),
  );
}

/** A submitted ID owns one exact host, source and path until it is explicitly resolved. */
export function recordPreparationReceipt(
  records: ProjectPreparationReceipts | undefined,
  receipt: ProjectPreparationReceipt,
): ProjectPreparationReceipts {
  const key = preparationReceiptKey(
    receipt.sourceEnvironmentId,
    receipt.sourceProjectId,
    receipt.destinationEnvironmentId,
  );
  if (records && Object.prototype.hasOwnProperty.call(records, key)) {
    const previous = records[key];
    if (
      !previous ||
      (Object.keys(receipt) as Array<keyof ProjectPreparationReceipt>).some(
        (field) => previous[field] !== receipt[field],
      )
    )
      throw new Error(
        "This preparation already owns a reviewed destination. Open its saved progress before starting another copy.",
      );
  }
  return { ...records, [key]: receipt };
}
