import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  createProjectStorageRolloutController,
  type ProjectStorageRolloutTarget,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Atom } from "effect/reactivity";
import { useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { environmentProjects } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { projectCheckouts } from "./state";
import {
  readProjectStorageRolloutTarget,
  type ProjectStorageInventoryTarget,
} from "./storageRolloutAccess";

/** Keeps the queue independent of search and rechecks live grants immediately before each RPC. */
export function useProjectStorageRollout(inventory: readonly ProjectStorageInventoryTarget[]) {
  const registry = useContext(RegistryContext);
  const preview = useAtomQueryRunner(projectCheckouts.preview, {
    refresh: true,
    reportFailure: false,
  });
  const adopt = useAtomCommand(projectCheckouts.adopt, { reportFailure: false });
  const setRetention = useAtomCommand(projectCheckouts.setRetention, { reportFailure: false });
  const permissionsAtom = useMemo(
    () =>
      Atom.make((get) =>
        inventory.map((target) => readProjectStorageRolloutTarget((atom) => get(atom), target)),
      ),
    [inventory],
  );
  const targets = useAtomValue(permissionsAtom);
  const controller = useMemo(() => {
    const assertAvailable = (
      target: ProjectStorageRolloutTarget,
      operation: "preview" | "adopt" | "retention",
    ) => {
      const currentProject = registry.get(
        environmentProjects.projectAtom({
          environmentId: target.environmentId,
          projectId: target.projectId,
        }),
      );
      if (currentProject?.workspaceRoot !== target.workspaceRoot) {
        throw new Error(
          "This project folder changed. Select and review its current location again.",
        );
      }
      const current = readProjectStorageRolloutTarget((atom) => registry.get(atom), target);
      if (
        target.connected !== current.connected ||
        target.supported !== current.supported ||
        target.canRead !== current.canRead ||
        target.canAdopt !== current.canAdopt ||
        target.canSetRetention !== current.canSetRetention ||
        target.reviewContext !== current.reviewContext
      ) {
        throw new Error(
          "This computer's connection or access changed. Review the folder again before continuing.",
        );
      }
      if (!current.connected || !current.supported || !current.canRead) {
        throw new Error(
          "This folder cannot be reviewed through the current connection. Check Connections, then review again.",
        );
      }
      if (
        operation !== "preview" &&
        !(operation === "adopt" ? current.canAdopt : current.canSetRetention)
      ) {
        throw new Error(
          "This connection is read-only. Check its settings access, then review again.",
        );
      }
    };
    return createProjectStorageRolloutController({
      preview: async (target) => {
        assertAvailable(target, "preview");
        const result = await preview({
          environmentId: target.environmentId,
          input: { projectId: target.projectId },
        });
        if (result._tag !== "Success") throw squashAtomCommandFailure(result);
        return result.value;
      },
      adopt: async (target, input) => {
        assertAvailable(target, "adopt");
        const result = await adopt({ environmentId: target.environmentId, input });
        if (result._tag !== "Success") throw squashAtomCommandFailure(result);
        registry.refresh(
          projectCheckouts.preview({
            environmentId: target.environmentId,
            input: { projectId: target.projectId },
          }),
        );
        return result.value;
      },
      setRetention: async (target, input) => {
        assertAvailable(target, "retention");
        const result = await setRetention({ environmentId: target.environmentId, input });
        if (result._tag !== "Success") throw squashAtomCommandFailure(result);
        registry.refresh(
          projectCheckouts.preview({
            environmentId: target.environmentId,
            input: { projectId: target.projectId },
          }),
        );
        return result.value;
      },
    });
  }, [registry, preview, adopt, setRetention]);
  useEffect(() => controller.syncTargets(targets), [controller, targets]);
  useEffect(() => () => controller.cancel(), [controller]);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return { controller, snapshot };
}
