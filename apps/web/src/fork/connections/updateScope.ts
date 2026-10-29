import type { ConnectionTarget } from "@t3tools/client-runtime/connection";
import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";

export type UpdateScope = "local" | "fleet";

/** A primary browser connection runs on its server, not on the browser's computer. */
function isLocalUpdateEnvironment(target: ConnectionTarget, desktop: boolean): boolean {
  return (
    desktop && (target._tag === "PrimaryConnectionTarget" || isDesktopLocalConnectionTarget(target))
  );
}

export function updateEnvironmentInScope(
  target: ConnectionTarget,
  scope: UpdateScope,
  desktop: boolean,
): boolean {
  return scope === "fleet" || isLocalUpdateEnvironment(target, desktop);
}
