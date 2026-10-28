import type { MenuAction } from "@react-native-menu/menu";
import { projectHomeThreadActions } from "./projectHomeThreadActions";

/** Project rows retain lifecycle controls, the reviewed Move work entry point and checkout release. */
export function projectHomeThreadMenuActions(
  input: Parameters<typeof projectHomeThreadActions>[0] & {
    readonly handoffSupported: boolean;
    /** The host supports checkout release and the thread has a worktree. */
    readonly checkoutReleaseSupported: boolean;
    readonly checkoutReleased?: boolean;
    readonly running: boolean;
  },
): ReadonlyArray<MenuAction> {
  const actions = projectHomeThreadActions(input);
  if (!input.connected || !input.permitted) return actions;
  return [
    ...actions,
    ...(input.handoffSupported
      ? [{ id: "move-work", title: "Move work", image: "arrow.left.arrow.right" }]
      : []),
    ...(input.checkoutReleaseSupported
      ? [
          {
            id: input.checkoutReleased ? "restore-checkout" : "release-checkout",
            title: input.checkoutReleased ? "Restore checkout" : "Release checkout",
            image: "folder",
            attributes: { disabled: input.running },
          },
        ]
      : []),
  ];
}
