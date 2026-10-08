import {
  AppleContainer,
  AppleDestination,
  type AppleRunKind,
  type AppleRunRequest,
} from "@t3tools/contracts/fork";
import type { ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/** What the panel remembers per environment and project on this client. */
export const AppleSelection = Schema.Struct({
  container: Schema.optional(AppleContainer),
  scheme: Schema.optional(Schema.String),
  configuration: Schema.optional(Schema.String),
  destination: Schema.optional(AppleDestination),
  testPlan: Schema.optional(Schema.String),
});
export type AppleSelection = typeof AppleSelection.Type;

export const SELECTION_STORAGE_KEY = "loom:apple-build-tooling:selection:v1";

const Selections = Schema.Record(Schema.String, AppleSelection);
const decodeSelections = Schema.decodeUnknownOption(Selections);

const selectionKey = (environmentId: string, projectId: string) =>
  `${environmentId}\u0000${projectId}`;

/** Parses the stored map; anything unreadable counts as nothing remembered. */
export function parseSelections(raw: string | null): Record<string, AppleSelection> {
  if (!raw) return {};
  try {
    const decoded = decodeSelections(JSON.parse(raw));
    return decoded._tag === "Some" ? { ...decoded.value } : {};
  } catch {
    return {};
  }
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readSelection(environmentId: string, projectId: string): AppleSelection {
  try {
    return (
      parseSelections(storage()?.getItem(SELECTION_STORAGE_KEY) ?? null)[
        selectionKey(environmentId, projectId)
      ] ?? {}
    );
  } catch {
    return {};
  }
}

export function writeSelection(
  environmentId: string,
  projectId: string,
  selection: AppleSelection,
): void {
  try {
    const store = storage();
    if (!store) return;
    const all = parseSelections(store.getItem(SELECTION_STORAGE_KEY));
    all[selectionKey(environmentId, projectId)] = selection;
    store.setItem(SELECTION_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Private mode or a full quota: the selection is simply not remembered.
  }
}

export type AppleAction = "build" | "test" | "run" | "releaseBuild" | "generate";

/** The run kind an action means for a container, or null when it cannot run there. */
export function runKindFor(container: AppleContainer, action: AppleAction): AppleRunKind | null {
  if (container.kind === "package")
    return action === "build" ? "swiftBuild" : action === "test" ? "swiftTest" : null;
  if (action === "generate") return container.kind === "xcodegen" ? "xcodegenGenerate" : null;
  if (container.kind === "xcodegen" && container.generatedProjectPath === undefined) return null;
  return action;
}

const needsScheme = (kind: AppleRunKind) =>
  kind === "build" || kind === "test" || kind === "run" || kind === "releaseBuild";

/** Builds a run request from a selection, or explains what is still missing. */
export function requestFor(
  threadId: ThreadId,
  selection: AppleSelection,
  action: AppleAction,
  onlyTesting?: ReadonlyArray<string>,
): { request: AppleRunRequest } | { missing: string } {
  const { container } = selection;
  if (!container) return { missing: "Choose a project first." };
  const kind = runKindFor(container, action);
  if (kind === null)
    return {
      missing:
        container.kind === "package"
          ? "A Swift package can only build and test."
          : container.kind === "xcodegen" && action !== "generate"
            ? "Generate the project from its XcodeGen spec first."
            : "This project cannot do that.",
    };
  if (!needsScheme(kind)) return { request: { workspace: { threadId }, kind, container } };
  if (!selection.scheme) return { missing: "Choose a scheme first." };
  if (kind === "run" && !selection.destination)
    return { missing: "Choose where to run the app first." };
  return {
    request: {
      workspace: { threadId },
      kind,
      container,
      scheme: selection.scheme,
      ...(selection.configuration ? { configuration: selection.configuration } : {}),
      ...(selection.destination ? { destination: selection.destination } : {}),
      ...(kind === "test" && selection.testPlan && !onlyTesting?.length
        ? { testPlan: selection.testPlan }
        : {}),
      ...(kind === "test" && onlyTesting?.length ? { onlyTesting } : {}),
    },
  };
}

/** Stable value for a destination in pickers and storage comparisons. */
export function destinationKey(destination: AppleDestination): string {
  switch (destination._tag) {
    case "simulator":
      return `simulator:${destination.udid}`;
    case "device":
      return `device:${destination.identifier}`;
    case "mac":
      return "mac";
    case "generic":
      return `generic:${destination.platform}`;
  }
}
