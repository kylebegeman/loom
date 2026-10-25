import { createReachAtoms } from "@t3tools/client-runtime/fork";
import { connectionAtomRuntime } from "~/connection/runtime";

export const reach = createReachAtoms(connectionAtomRuntime);
