import {
  createReachAtoms,
  createDirectoryReportingAtoms,
  type ReachTone,
} from "@t3tools/client-runtime/fork";

import { connectionAtomRuntime } from "../../connection/runtime";

export const reach = createReachAtoms(connectionAtomRuntime);

export const REACH_INK: Readonly<Record<ReachTone, string>> = {
  neutral: "text-foreground-muted",
  active: "text-foreground-muted",
  success: "text-foreground-muted",
  warning: "text-warning-foreground",
  danger: "text-danger-foreground",
};

export const directoryReporting = createDirectoryReportingAtoms(connectionAtomRuntime);
