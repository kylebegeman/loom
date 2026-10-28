import { HardDriveIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import {
  FEATURE,
  lanes,
  openStorageSettings,
  releaseThreadCheckout,
  restoreThreadCheckout,
} from "./state";
import { useThreadCheckoutReleased } from "./CheckoutStatus";
import { useQuietThreadShell } from "~/state/entities";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { CHECKOUT_RELEASE_FEATURE, CHECKOUT_RESTORE_FEATURE } from "@t3tools/contracts/fork";
import { threadRuntimeCanArchive } from "@t3tools/client-runtime/state/models";
const denied = Atom.make(false);
export function useCheckoutPaletteContext(threadRef: ScopedThreadRef | null) {
  const thread = useQuietThreadShell(threadRef);
  const released = useThreadCheckoutReleased(threadRef);
  const canRelease = useAtomValue(
    threadRef ? lanes.releaseCheckout.permissionAtom(threadRef.environmentId) : denied,
  );
  const canRestore = useAtomValue(
    threadRef ? lanes.restoreCheckout.permissionAtom(threadRef.environmentId) : denied,
  );
  return thread && thread.worktreePath && threadRuntimeCanArchive(thread.runtime)
    ? { released, canRelease, canRestore }
    : null;
}

export const projectLifecyclePaletteSource: ForkCommandPaletteSource = {
  id: FEATURE,
  items: ({ loomFeatures, activeThreadRef, checkout }) =>
    loomFeatures.includes(FEATURE)
      ? [
          ...(activeThreadRef &&
          checkout &&
          checkout.released === true &&
          checkout.canRestore &&
          loomFeatures.includes(CHECKOUT_RESTORE_FEATURE)
            ? [
                {
                  kind: "action" as const,
                  value: "action:loom:project-lifecycle:restore-checkout",
                  title: "Restore checkout",
                  searchTerms: ["restore", "checkout", "files"],
                  icon: <HardDriveIcon className="size-4" />,
                  run: async () => restoreThreadCheckout(activeThreadRef),
                },
              ]
            : []),
          ...(activeThreadRef &&
          checkout &&
          checkout.released === false &&
          checkout.canRelease &&
          loomFeatures.includes(CHECKOUT_RELEASE_FEATURE)
            ? [
                {
                  kind: "action" as const,
                  value: "action:loom:project-lifecycle:release-checkout",
                  title: "Release checkout",
                  searchTerms: ["release", "checkout", "files", "disk"],
                  icon: <HardDriveIcon className="size-4" />,
                  run: async () => releaseThreadCheckout(activeThreadRef),
                },
              ]
            : []),
          {
            kind: "action",
            value: `action:loom:${FEATURE}:open`,
            title: "Storage and lanes",
            description: "Lane caps, disk space and cleanup",
            searchTerms: ["disk", "space", "lanes", "tmp", "DerivedData", "cleanup", "storage"],
            icon: <HardDriveIcon className="size-4" />,
            run: async () => {
              openStorageSettings();
            },
          },
        ]
      : [],
};
