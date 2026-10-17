import { createSitesAtoms } from "@t3tools/client-runtime/fork";
import { connectionAtomRuntime } from "~/connection/runtime";
export const sites = createSitesAtoms(connectionAtomRuntime);
