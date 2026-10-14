import { EnvironmentId, ProjectId, type ScopedProjectRef } from "@t3tools/contracts";

/** A prepared checkout is a physical destination, even when its project is grouped across hosts. */
export function validateProjectHomeSearch(raw: Record<string, unknown>): {
  computer?: EnvironmentId;
  checkoutId?: ProjectId;
} {
  if (
    typeof raw.computer !== "string" ||
    typeof raw.checkoutId !== "string" ||
    !raw.computer.trim() ||
    !raw.checkoutId.trim()
  )
    return {};
  return { computer: EnvironmentId.make(raw.computer), checkoutId: ProjectId.make(raw.checkoutId) };
}

export function projectHomeDestinationFromSearch(
  search: ReturnType<typeof validateProjectHomeSearch>,
): ScopedProjectRef | null {
  return search.computer && search.checkoutId
    ? { environmentId: search.computer, projectId: search.checkoutId }
    : null;
}
