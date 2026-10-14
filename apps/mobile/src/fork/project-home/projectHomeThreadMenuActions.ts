import type { MenuAction } from "@react-native-menu/menu";
import { projectHomeThreadActions } from "./projectHomeThreadActions";

/** Project rows retain lifecycle controls and the existing reviewed Move work entry point. */
export function projectHomeThreadMenuActions(
  input: Parameters<typeof projectHomeThreadActions>[0] & { readonly handoffSupported: boolean },
): ReadonlyArray<MenuAction> {
  const actions = projectHomeThreadActions(input);
  return input.connected && input.permitted && input.handoffSupported
    ? [...actions, { id: "move-work", title: "Move work", image: "arrow.left.arrow.right" }]
    : actions;
}
