import { createDirectoryComputersAtoms } from "@t3tools/client-runtime/fork";
import { connectionAtomRuntime } from "~/connection/runtime";

export const directoryComputers = createDirectoryComputersAtoms(connectionAtomRuntime);
