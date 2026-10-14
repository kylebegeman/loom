import {
  connectionRouteId,
  connectionRoutes,
  routeHttpBaseUrl,
} from "@t3tools/client-runtime/connection";
import {
  supportsLoomFeature,
  type ProjectStorageRolloutTarget,
} from "@t3tools/client-runtime/fork";
import { AuthOrchestrationReadScope, sessionGrantsScope } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { AsyncResult, type Atom } from "effect/reactivity";
import { environmentCatalog } from "~/connection/catalog";
import { environmentPresentations } from "~/state/presentation";
import { environmentSession } from "~/state/session";
import { PROJECT_CHECKOUT_FEATURE, projectCheckouts } from "./state";

type ReadAtom = <A>(atom: Atom.Atom<A>) => A;
export type ProjectStorageInventoryTarget = Omit<
  ProjectStorageRolloutTarget,
  "canAdopt" | "canSetRetention" | "reviewContext"
>;

/** The same access snapshot drives reactive invalidation and the last check before transport. */
export function readProjectStorageRolloutTarget(
  read: ReadAtom,
  target: ProjectStorageInventoryTarget,
): ProjectStorageRolloutTarget {
  const computer = read(environmentPresentations.presentationAtom(target.environmentId));
  const connectionState = read(environmentCatalog.stateAtom(target.environmentId));
  const sessionResult = read(environmentSession.sessionStateAtom(target.environmentId));
  const session = Option.getOrNull(AsyncResult.value(sessionResult));
  return {
    ...target,
    connected: computer?.entry.enabled === true && computer.connection.phase === "connected",
    supported: supportsLoomFeature(
      computer?.serverConfig?.environment.capabilities,
      PROJECT_CHECKOUT_FEATURE,
    ),
    canRead:
      sessionResult._tag !== "Failure" &&
      session !== null &&
      sessionGrantsScope(session, AuthOrchestrationReadScope),
    canAdopt: read(projectCheckouts.adopt.permissionAtom(target.environmentId)),
    canSetRetention: read(projectCheckouts.setRetention.permissionAtom(target.environmentId)),
    reviewContext: JSON.stringify([
      Option.getOrNull(AsyncResult.value(connectionState))?.generation ?? null,
      computer
        ? connectionRoutes(computer.entry).map((route) => [
            connectionRouteId(route.target),
            routeHttpBaseUrl(route),
          ])
        : [],
      computer?.serverConfig?.environment.capabilities ?? null,
      session?.sessionMethod ?? null,
      [...(session?.permissions ?? [])].sort(),
      [...(session?.scopes ?? [])].sort(),
      session?.auth.policy ?? null,
      session?.expiresAt ? DateTime.formatIso(session.expiresAt) : null,
    ]),
  };
}
