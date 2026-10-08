import { createPcbPreviewAtoms } from "@t3tools/client-runtime/fork";
import { connectionAtomRuntime } from "~/connection/runtime";
export const pcb = createPcbPreviewAtoms(connectionAtomRuntime);
