import {
  PROJECT_STORAGE_WS_METHODS as S,
  type ProjectStorageCategory,
  type ProjectStorageCategoryTotal,
} from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import * as Effect from "effect/Effect";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

export function createProjectStorageAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const report = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:storage:inventory",
    tag: S.byCategory,
  });
  const refresh = createEnvironmentRpcCommand(runtime, {
    label: "loom:storage:refresh",
    tag: S.byCategory,
    concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    onSuccess: ({ environmentId }, registry) =>
      Effect.sync(() => registry.refresh(report({ environmentId, input: {} }))),
  });
  return { report, refresh };
}

export const STORAGE_CATEGORY_LABELS: Record<ProjectStorageCategory, string> = {
  worktrees: "Worktrees",
  primary: "Primary checkouts",
  "library-copies": "Library copies",
  "git-mirrors": "Git mirrors",
  lanes: "Lanes",
  scratch: "Scratch",
  database: "Database",
};

export function storageBytes(bytes: number) {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

export function storageCategorySize(row: ProjectStorageCategoryTotal) {
  return row.bytes === null
    ? row.knownBytes > 0
      ? `At least ${storageBytes(row.knownBytes)}`
      : "Not measured"
    : storageBytes(row.bytes);
}

export function storageCategoryDetail(row: ProjectStorageCategoryTotal) {
  const details = [`${row.locations} ${row.locations === 1 ? "location" : "locations"}`];
  if (row.kind === "worktrees") {
    if (row.landed > 0) details.push(`${row.landed} landed`);
    if (row.released > 0) details.push(`${row.released} released`);
  }
  if (row.unknownLocations > 0) details.push(`${row.unknownLocations} could not be measured`);
  return details.join(" · ");
}

export function storageMeasuredAge(measuredAt: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(measuredAt)) / 60_000));
  if (!Number.isFinite(minutes)) return "at an unknown time";
  if (minutes === 0) return "less than a minute ago";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}

export function storageWebSettingsUrl(address: string | null | undefined): string | null {
  if (!address) return null;
  try {
    const url = new URL(address);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return new URL("/settings/worktrees", url.origin).toString();
  } catch {
    return null;
  }
}
