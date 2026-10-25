import { createLibraryPushAtoms } from "@t3tools/client-runtime/fork";
import { connectionAtomRuntime } from "~/connection/runtime";

export const libraryPush = createLibraryPushAtoms(connectionAtomRuntime);
