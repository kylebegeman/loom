import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryInfo, LibraryProject } from "@t3tools/contracts/fork";

export function librarySignInTarget(input: {
  readonly candidate: Pick<LibraryInfo, "environmentId" | "isAuthority" | "destination"> | null;
  readonly candidateUrl: string | null;
  readonly destination: LibraryInfo["destination"];
}) {
  if (input.candidateUrl && input.candidate?.isAuthority === true)
    return { environmentId: input.candidate.environmentId, url: input.candidateUrl };
  return input.candidate?.destination ?? input.destination ?? null;
}

/** App-shell navigation reads the deepest active route, outside the leaf route's React context. */
export function libraryRouteParams(params: unknown) {
  const record = params !== null && typeof params === "object" ? params : {};
  return {
    projectId:
      "projectId" in record && typeof record.projectId === "string" ? record.projectId : undefined,
    conversationId:
      "conversationId" in record && typeof record.conversationId === "string"
        ? record.conversationId
        : undefined,
    environmentId:
      "environmentId" in record && typeof record.environmentId === "string"
        ? record.environmentId
        : undefined,
    threadId:
      "threadId" in record && typeof record.threadId === "string" ? record.threadId : undefined,
  };
}

/** A newly created project must remain selected before every catalog query has refreshed. */
export function resolveLibrarySelection(input: {
  readonly routeProjectId?: string;
  readonly savedProjectId: string | null;
  readonly catalog: readonly LibraryProject[];
  readonly detail: LibraryProject | null;
}) {
  const id = input.routeProjectId ?? input.savedProjectId;
  const catalogProject = input.catalog.find((entry) => entry.id === id) ?? null;
  const detail = input.detail?.id === id ? input.detail : null;
  const project =
    detail && (!catalogProject || detail.revision > catalogProject.revision)
      ? detail
      : catalogProject;
  const projects =
    project && !catalogProject
      ? [...input.catalog, project]
      : project && catalogProject !== project
        ? input.catalog.map((entry) => (entry.id === project.id ? project : entry))
        : input.catalog;
  return { id, project, projects };
}

/** Only a confirmed authority matching the connected computers can initialize an empty choice. */
export function resolveLibraryAuthorityId(
  reports: readonly Pick<LibraryInfo, "environmentId" | "isAuthority" | "destination">[],
  primaryId: EnvironmentId | null = null,
) {
  const primary = primaryId ? reports.find((report) => report.environmentId === primaryId) : null;
  const candidates = new Set(
    (primary ? [primary] : reports).flatMap((report) => {
      const id = report.isAuthority ? report.environmentId : report.destination?.environmentId;
      return id ? [id] : [];
    }),
  );
  if (candidates.size !== 1) return null;
  const id = [...candidates][0]!;
  return reports.some((report) => report.environmentId === id && report.isAuthority) ? id : null;
}
