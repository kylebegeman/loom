import type { ProjectConversationView } from "@t3tools/client-runtime/fork";

/** Pin the first loaded inventory's default until this project screen is left. */
export function pinProjectHomeView(
  current: ProjectConversationView | null,
  inventory: { readonly view: ProjectConversationView; readonly counts: { readonly all: number } },
): ProjectConversationView | null {
  return current ?? (inventory.counts.all > 0 ? inventory.view : null);
}
