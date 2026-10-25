import type { EnvironmentId } from "@t3tools/contracts";
import { LIBRARY_PUSH_WS_METHODS, type LibraryPushStatus } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

/** Opening the status again after this long reads it again. Nothing reads it on a timer. */
const STATUS_STALE_MS = 15_000;
const IDLE_TTL_MS = 5 * 60_000;

/** Stands in while no Library is chosen or it lacks `library-push`, so nothing is read. */
const IDLE_STATUS = Atom.make(AsyncResult.initial<LibraryPushStatus, never>(false)).pipe(
  Atom.withLabel("loom:library-push:status:idle"),
);

/**
 * Library push notifications, shared by web, desktop and mobile. Every request runs on the
 * Library's connection; the Library never forwards them from a computer.
 */
export function createLibraryPushAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const status = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:library-push:status",
    tag: LIBRARY_PUSH_WS_METHODS.status,
    staleTimeMs: STATUS_STALE_MS,
    idleTtlMs: IDLE_TTL_MS,
  });
  // A refused change can still have moved the device list (an expired row pruned, a dead token
  // dropped by a test), so the status reads again either way.
  const refreshStatus = (
    { environmentId }: { readonly environmentId: EnvironmentId },
    registry: AtomRegistry.AtomRegistry,
  ) => Effect.sync(() => registry.refresh(status({ environmentId, input: {} })));
  return {
    /** Pass the Library's id, or null. Refresh this atom for an explicit refresh. */
    status: (
      libraryId: EnvironmentId | null,
    ): Atom.Atom<AsyncResult.AsyncResult<LibraryPushStatus, unknown>> =>
      libraryId === null ? IDLE_STATUS : status({ environmentId: libraryId, input: {} }),
    register: createEnvironmentRpcCommand(runtime, {
      label: "loom:library-push:register",
      tag: LIBRARY_PUSH_WS_METHODS.register,
      onSettled: refreshStatus,
    }),
    unregister: createEnvironmentRpcCommand(runtime, {
      label: "loom:library-push:unregister",
      tag: LIBRARY_PUSH_WS_METHODS.unregister,
      onSettled: refreshStatus,
    }),
    test: createEnvironmentRpcCommand(runtime, {
      label: "loom:library-push:test",
      tag: LIBRARY_PUSH_WS_METHODS.test,
      onSettled: refreshStatus,
    }),
  };
}
