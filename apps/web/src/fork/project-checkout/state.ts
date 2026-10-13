import { createProjectCheckoutAtoms } from "@t3tools/client-runtime/fork";
import { connectionAtomRuntime } from "~/connection/runtime";

export const projectCheckouts = createProjectCheckoutAtoms(connectionAtomRuntime);
export { PROJECT_CHECKOUT_FEATURE } from "@t3tools/contracts/fork";
