import { ModelWorkspace, type ModelWorkspaceOperation } from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
const decode = Schema.decodeUnknownSync(ModelWorkspace);
/** Operations merge individual identities, preserving simultaneous proposals from other clients. */
export function applyWorkspaceOperation(state: ModelWorkspace, operation: ModelWorkspaceOperation) {
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
  return decode({
    ...state,
    [collection]: state[collection].some((item) => item.id === operation.item.id)
      ? state[collection].map((item) => (item.id === operation.item.id ? operation.item : item))
      : [...state[collection], operation.item],
  });
}
