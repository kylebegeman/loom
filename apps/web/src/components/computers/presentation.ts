import type { ServerProvider } from "@t3tools/contracts";

/** Only installed, usable instances with selectable models can start work. */
export function readyAgentCount(
  providers: ReadonlyArray<
    Pick<ServerProvider, "enabled" | "installed" | "status" | "availability" | "models">
  >,
): number {
  return providers.filter(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      provider.status === "ready" &&
      provider.availability !== "unavailable" &&
      provider.models.length > 0,
  ).length;
}
