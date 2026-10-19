import { PREVIEW_LINKS_WS_METHODS as P } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

/** Preview links belong to the computer that serves the port; every request stays on that host. */
export function createPreviewLinksAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    snapshot: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:preview-links",
      tag: P.watch,
    }),
    configure: createEnvironmentRpcCommand(runtime, {
      label: "loom:preview-links-configure",
      tag: P.configure,
    }),
    share: createEnvironmentRpcCommand(runtime, {
      label: "loom:preview-links-share",
      tag: P.share,
    }),
    open: createEnvironmentRpcCommand(runtime, { label: "loom:preview-links-open", tag: P.open }),
    extend: createEnvironmentRpcCommand(runtime, {
      label: "loom:preview-links-extend",
      tag: P.extend,
    }),
    revoke: createEnvironmentRpcCommand(runtime, {
      label: "loom:preview-links-revoke",
      tag: P.revoke,
    }),
    restore: createEnvironmentRpcCommand(runtime, {
      label: "loom:preview-links-restore",
      tag: P.restore,
    }),
    revokeAll: createEnvironmentRpcCommand(runtime, {
      label: "loom:preview-links-revoke-all",
      tag: P.revokeAll,
    }),
    signOutBrowsers: createEnvironmentRpcCommand(runtime, {
      label: "loom:preview-links-sign-out",
      tag: P.signOutBrowsers,
    }),
  };
}
