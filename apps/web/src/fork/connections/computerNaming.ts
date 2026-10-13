import { createComputerNamingAtoms } from "@t3tools/client-runtime/fork";
import { connectionAtomRuntime } from "~/connection/runtime";

export const computerNaming = createComputerNamingAtoms(connectionAtomRuntime);
