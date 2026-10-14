import { useAtomValue } from "@effect/atom-react";
import {
  canReviewProjectStorageTarget,
  createProjectCheckoutAtoms,
  createProjectStorageRolloutController,
  projectStorageRolloutComputerLabels,
  projectStorageRolloutKey,
  supportsLoomFeature,
  type ProjectStorageRolloutTarget,
} from "@t3tools/client-runtime/fork";
import { connectionRouteId, connectionRoutes } from "@t3tools/client-runtime/connection";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope, sessionGrantsScope } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { environmentCatalog } from "../../../connection/catalog";
import { connectionAtomRuntime } from "../../../connection/runtime";
import { appAtomRegistry } from "../../../state/atom-registry";
import { environmentPresentations } from "../../../state/presentation";
import { environmentProjects } from "../../../state/projects";
import { serverEnvironment } from "../../../state/server";
import { environmentSession } from "../../../state/session";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useAtomQueryRunner } from "../../../state/use-atom-query-runner";

const checkout = createProjectCheckoutAtoms(connectionAtomRuntime);
type ReadAtom = <A>(atom: Atom.Atom<A>) => A;

/** Subscribe to the same live host/grant data that is rechecked before each RPC. */
function readTargets(get: ReadAtom): ReadonlyArray<ProjectStorageRolloutTarget> {
  const computerLabels = projectStorageRolloutComputerLabels(
    new Map(
      [...get(environmentPresentations.presentationsAtom)].map(([environmentId, presentation]) => [
        environmentId,
        presentation.entry.target.label,
      ]),
    ),
  );
  return get(environmentProjects.projectsAtom).map((project) => {
    const environmentId = project.environmentId;
    const presentation = get(environmentPresentations.presentationAtom(environmentId));
    const config = get(serverEnvironment.configValueAtom(environmentId));
    const sessionResult = get(environmentSession.sessionStateAtom(environmentId));
    const session = Option.getOrNull(AsyncResult.value(sessionResult));
    const connection = Option.getOrNull(
      AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
    );
    const routes = presentation
      ? connectionRoutes(presentation.entry).map((route) => {
          const profile = Option.getOrNull(route.profile);
          return [
            connectionRouteId(route.target),
            route.target._tag === "PrimaryConnectionTarget"
              ? [route.target.httpBaseUrl, route.target.wsBaseUrl]
              : null,
            profile?._tag === "BearerConnectionProfile"
              ? [profile.httpBaseUrl, profile.wsBaseUrl]
              : profile?._tag === "SshConnectionProfile"
                ? profile.target
                : null,
          ];
        })
      : [];
    return {
      environmentId,
      projectId: project.id,
      workspaceRoot: project.workspaceRoot,
      projectName: project.title,
      environmentLabel: computerLabels.get(environmentId) ?? "Computer",
      connected:
        presentation?.entry.enabled === true && presentation.connection.phase === "connected",
      supported: supportsLoomFeature(
        config?.environment.capabilities,
        "project-checkout-management",
      ),
      canRead:
        sessionResult._tag !== "Failure" &&
        session !== null &&
        sessionGrantsScope(session, AuthOrchestrationReadScope),
      reviewContext: JSON.stringify([
        connection?.generation ?? null,
        routes,
        config?.environment.capabilities ?? null,
        session?.authenticated ?? false,
        session?.sessionMethod ?? null,
        session?.permissions ? [...session.permissions].sort() : null,
        session?.scopes ? [...session.scopes].sort() : null,
      ]),
      canAdopt: get(checkout.adopt.permissionAtom(environmentId)),
      canSetRetention: get(checkout.setRetention.permissionAtom(environmentId)),
    };
  });
}

const targetsAtom = Atom.make(readTargets);

export function useProjectStorageRollout() {
  const targets = useAtomValue(targetsAtom);
  const preview = useAtomQueryRunner(checkout.preview, { reportFailure: false, refresh: true });
  const adopt = useAtomCommand(checkout.adopt, { reportFailure: false });
  const setRetention = useAtomCommand(checkout.setRetention, { reportFailure: false });
  const controller = useMemo(() => {
    function currentTarget(target: ProjectStorageRolloutTarget) {
      const current = readTargets((atom) => appAtomRegistry.get(atom));
      rollout.syncTargets(current);
      const found = current.find(
        (entry) => projectStorageRolloutKey(entry) === projectStorageRolloutKey(target),
      );
      if (
        !found ||
        !canReviewProjectStorageTarget(found) ||
        found.connected !== target.connected ||
        found.supported !== target.supported ||
        found.canRead !== target.canRead ||
        found.canAdopt !== target.canAdopt ||
        found.canSetRetention !== target.canSetRetention ||
        found.reviewContext !== target.reviewContext
      ) {
        throw new Error("This folder or computer changed. Review it again before continuing.");
      }
      return found;
    }
    const rollout = createProjectStorageRolloutController({
      preview: async (target) => {
        const current = currentTarget(target);
        const result = await preview({
          environmentId: current.environmentId,
          input: { projectId: current.projectId },
        });
        if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
        return result.value;
      },
      adopt: async (target, input) => {
        const current = currentTarget(target);
        if (!current.canAdopt)
          throw new Error("Settings permission is required to adopt this folder.");
        const result = await adopt({ environmentId: current.environmentId, input });
        if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
        return result.value;
      },
      setRetention: async (target, input) => {
        const current = currentTarget(target);
        if (!current.canSetRetention)
          throw new Error("Settings permission is required to save this storage preference.");
        const result = await setRetention({ environmentId: current.environmentId, input });
        if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
        return result.value;
      },
    });
    return rollout;
  }, [preview, adopt, setRetention]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    controller.syncTargets(targets);
  }, [controller, targets]);
  // Cancelling stops unissued work and also survives React StrictMode effect replay.
  useEffect(() => () => controller.cancel(), [controller]);
  return { controller, snapshot, targets };
}
