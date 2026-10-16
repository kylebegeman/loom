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

const BRIEF_EVENT = "loom:library:edit-brief";
let pendingBrief: string | null = null;

/**
 * Asks the project page to open its brief editor. A page already showing the project opens it
 * at once; otherwise the request waits for that project's page to mount.
 */
export function requestLibraryBriefEdit(projectId: string) {
  pendingBrief = projectId;
  window.dispatchEvent(new Event(BRIEF_EVENT));
}

/** True once for the project the last request named. */
export function takeLibraryBriefEdit(projectId: string) {
  if (pendingBrief !== projectId) return false;
  pendingBrief = null;
  return true;
}

export function onLibraryBriefEdit(listener: () => void) {
  window.addEventListener(BRIEF_EVENT, listener);
  return () => window.removeEventListener(BRIEF_EVENT, listener);
}
