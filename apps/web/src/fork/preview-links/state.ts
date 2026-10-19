import { createPreviewLinksAtoms } from "@t3tools/client-runtime/fork";
import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import { PREVIEW_LINKS_FEATURE } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";

export const previewLinks = createPreviewLinksAtoms(connectionAtomRuntime);

export const FEATURE = PREVIEW_LINKS_FEATURE;
/** Anchor of the Previews section on the Loom settings page. */
export const SETTINGS_HASH = `loom-${FEATURE}`;

export async function runCommand<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<A> {
  const result = await command.run(appAtomRegistry, input);
  if (result._tag === "Failure") throw Cause.squash(result.cause);
  return result.value;
}

export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : String(error);

const sheetListeners = new Set<() => void>();
const settingsListeners = new Set<() => void>();

/** Lets pure palette items and toasts open the Links sheet through the mounted host. */
export function onOpenPreviewLinksSheet(callback: () => void) {
  sheetListeners.add(callback);
  return () => {
    sheetListeners.delete(callback);
  };
}

export function openPreviewLinksSheet() {
  for (const callback of sheetListeners) callback();
}

/** Lets code outside the router open Settings > Loom > Previews through the mounted host. */
export function onOpenPreviewLinksSettings(callback: () => void) {
  settingsListeners.add(callback);
  return () => {
    settingsListeners.delete(callback);
  };
}

export function openPreviewLinksSettings() {
  for (const callback of settingsListeners) callback();
}
