import {
  createDirectoryComputersAtoms,
  createDirectoryReportingAtoms,
} from "@t3tools/client-runtime/fork";
import { connectionAtomRuntime } from "~/connection/runtime";

export const directoryComputers = createDirectoryComputersAtoms(connectionAtomRuntime);

export const directoryReporting = createDirectoryReportingAtoms(connectionAtomRuntime);
