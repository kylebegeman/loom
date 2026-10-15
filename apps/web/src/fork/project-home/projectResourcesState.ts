import { createProjectResourcesAtoms } from "@t3tools/client-runtime/fork";
import { connectionAtomRuntime } from "~/connection/runtime";

export const projectResources = createProjectResourcesAtoms(connectionAtomRuntime);
