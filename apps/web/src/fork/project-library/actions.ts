import type { EnvironmentId } from "@t3tools/contracts";
export type LibraryAction = "create-project" | "import-folder" | "new-conversation";
export interface LibraryConversationDefaults {
  readonly environmentId?: EnvironmentId;
  readonly workingCopyId?: string;
  readonly resourceId?: string;
}
const EVENT = "loom:library:action";

/** Every entry point opens the same flow, including first-time Library setup. */
export function openLibraryAction(
  action: LibraryAction,
  projectId?: string,
  defaults?: LibraryConversationDefaults,
) {
  window.dispatchEvent(
    new CustomEvent(EVENT, {
      detail: projectId ? { action, projectId, ...(defaults ? { defaults } : {}) } : action,
    }),
  );
  return true;
}

export function onLibraryAction(
  listener: (
    action: LibraryAction,
    projectId?: string,
    defaults?: LibraryConversationDefaults,
  ) => void,
) {
  const handler = (event: Event) => {
    const detail = (
      event as CustomEvent<
        | LibraryAction
        | { action: LibraryAction; projectId: string; defaults?: LibraryConversationDefaults }
      >
    ).detail;
    if (typeof detail === "string") listener(detail);
    else if (detail.defaults) listener(detail.action, detail.projectId, detail.defaults);
    else listener(detail.action, detail.projectId);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
