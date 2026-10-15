import {
  MODEL_WORKSPACE_LIMITS,
  ModelWorkspace,
  normalizeQuaternion,
  type ModelWorkspaceOperation,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
const decode = Schema.decodeUnknownSync(ModelWorkspace);
/** How the panel names each collection, so a full one reports its real limit. */
const COLLECTION_NAMES = {
  views: "saved views",
  measurements: "measurements",
  annotations: "change requests",
  presets: "review sheets",
  variants: "variants",
} as const satisfies Record<keyof typeof MODEL_WORKSPACE_LIMITS, string>;
/** Operations merge individual identities, preserving simultaneous proposals from other clients. */
export function applyWorkspaceOperation(state: ModelWorkspace, operation: ModelWorkspaceOperation) {
  if (operation.kind === "orientation")
    return decode({
      ...state,
      orientation: operation.item && {
        ...operation.item,
        quaternion: normalizeQuaternion(operation.item.quaternion),
      },
    });
  if (operation.kind === "remove") {
    const next = {
      ...state,
      [operation.collection]: state[operation.collection].filter(
        (item) => item.id !== operation.id,
      ),
    };
    if (operation.collection === "views")
      next.presets = state.presets.flatMap((preset) => {
        const viewIds = preset.viewIds.filter((id) => id !== operation.id);
        return viewIds.length ? [{ ...preset, viewIds }] : [];
      });
    return decode(next);
  }
  const collection = (
    {
      view: "views",
      measurement: "measurements",
      annotation: "annotations",
      preset: "presets",
      variant: "variants",
    } as const
  )[operation.kind];
  const exists = state[collection].some((item) => item.id === operation.item.id);
  if (!exists && state[collection].length >= MODEL_WORKSPACE_LIMITS[collection])
    throw new Error(
      `Keep up to ${MODEL_WORKSPACE_LIMITS[collection]} ${COLLECTION_NAMES[collection]}. Delete some before adding more.`,
    );
  return decode({
    ...state,
    [collection]: exists
      ? state[collection].map((item) => (item.id === operation.item.id ? operation.item : item))
      : [...state[collection], operation.item],
  });
}
