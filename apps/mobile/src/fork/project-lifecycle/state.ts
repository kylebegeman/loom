import { createProjectLifecycleAtoms } from "@t3tools/client-runtime/fork";
import { connectionAtomRuntime } from "../../connection/runtime";

export const lanes = createProjectLifecycleAtoms(connectionAtomRuntime);
