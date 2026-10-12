import { randomUUID } from "~/lib/utils";
import { ScopedThreadRef } from "@t3tools/contracts";
import {
  createWorkspaceHandoffAtoms,
  type WorkspaceHandoffAttempt,
  type WorkspaceHandoffPhase,
} from "@t3tools/client-runtime/fork";
import { WorkspaceHandoffAttemptRecord } from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { connectionAtomRuntime } from "~/connection/runtime";
export const FEATURE = "workspace-handoff";
export const handoff = createWorkspaceHandoffAtoms(connectionAtomRuntime);
type HandoffState = WorkspaceHandoffAttempt & {
  open: boolean;
  source: ScopedThreadRef | null;
  requestId: string;
  destinationKey: string;
  phase: WorkspaceHandoffPhase | "idle";
  error: string | null;
};
const SavedHandoff = Schema.Struct({
  ...WorkspaceHandoffAttemptRecord.fields,
  source: ScopedThreadRef,
  phase: Schema.Literals(["idle", "checking", "preparing", "settling", "continuing", "done"]),
});
const decodeSavedHandoff = Schema.decodeUnknownOption(SavedHandoff);
export const useWorkspaceHandoff = create<HandoffState>()(
  persist<HandoffState>(
    () => ({
      open: false,
      source: null,
      requestId: "",
      destinationKey: "",
      phase: "idle",
      error: null,
      offer: null,
      receipt: null,
      sourceResult: null,
    }),
    {
      name: "loom-workspace-handoff",
      version: 1,
      storage: createJSONStorage(() => sessionStorage),
      merge: (persisted, current) => {
        const decoded = decodeSavedHandoff(persisted);
        return Option.isSome(decoded)
          ? {
              ...current,
              ...decoded.value,
              open: false,
              phase: decoded.value.phase === "done" ? "done" : "idle",
            }
          : current;
      },
      partialize: (state) => ({
        ...state,
        open: false,
        phase: state.phase === "done" ? "done" : "idle",
      }),
    },
  ),
);
export function openWorkspaceHandoff(source: ScopedThreadRef) {
  const previous = useWorkspaceHandoff.getState();
  if (["checking", "preparing", "settling", "continuing"].includes(previous.phase)) {
    useWorkspaceHandoff.setState({ open: true });
    return;
  }
  if (
    previous.source?.environmentId === source.environmentId &&
    previous.source.threadId === source.threadId
  )
    useWorkspaceHandoff.setState({ open: true });
  else
    useWorkspaceHandoff.setState({
      open: true,
      source,
      requestId: randomUUID(),
      destinationKey: "",
      phase: "idle",
      error: null,
      offer: null,
      receipt: null,
      sourceResult: null,
    });
}
