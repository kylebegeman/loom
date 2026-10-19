import { createPreviewLinksAtoms } from "@t3tools/client-runtime/fork";
import { connectionAtomRuntime } from "../../connection/runtime";
export const previewLinks = createPreviewLinksAtoms(connectionAtomRuntime);
