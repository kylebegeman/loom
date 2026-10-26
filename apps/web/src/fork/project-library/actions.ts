import type {
  EnvironmentId,
  ModelSelection,
  RuntimeMode,
  ProviderInteractionMode,
} from "@t3tools/contracts";
export type LibraryAction = "create-project" | "import-folder" | "new-conversation";
export interface LibraryConversationDefaults {
  readonly environmentId?: EnvironmentId;
  readonly workingCopyId?: string;
  readonly resourceId?: string;
  readonly resourceIds?: readonly string[];
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode;
}
const EVENT = "loom:library:action";

interface LibraryActionDetail {
  readonly action: LibraryAction;
  readonly projectId?: string;
  readonly defaults?: LibraryConversationDefaults;
  /**
   * The project only leads the list, as the likely choice, instead of opening its settings. Used
   * when the project comes from where the user is rather than from a choice they made.
   */
  readonly suggest?: boolean;
}

/**
 * Every entry point opens the same flow, including first-time Library setup. `create-project`
 * asks how to start; `import-folder` goes straight to choosing a folder.
 */
export function openLibraryAction(
  action: LibraryAction,
  projectId?: string,
  defaults?: LibraryConversationDefaults,
  options?: { readonly suggest?: boolean },
) {
  window.dispatchEvent(
    new CustomEvent(EVENT, {
      detail:
        projectId || defaults
          ? {
              action,
              ...(projectId ? { projectId } : {}),
              ...(defaults ? { defaults } : {}),
              ...(projectId && options?.suggest ? { suggest: true } : {}),
            }
          : action,
    }),
  );
  return true;
}

export function onLibraryAction(
  listener: (
    action: LibraryAction,
    projectId?: string,
    defaults?: LibraryConversationDefaults,
    suggest?: boolean,
  ) => void,
) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<LibraryAction | LibraryActionDetail>).detail;
    if (typeof detail === "string") listener(detail);
    else if (detail.suggest) listener(detail.action, detail.projectId, detail.defaults, true);
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

/** Drops a request this project's page never took, so a later visit does not open the editor. */
export function dropLibraryBriefEdit(projectId: string) {
  if (pendingBrief === projectId) pendingBrief = null;
}

export function onLibraryBriefEdit(listener: () => void) {
  window.addEventListener(BRIEF_EVENT, listener);
  return () => window.removeEventListener(BRIEF_EVENT, listener);
}

const CLONE_EVENT = "loom:library:clone";
let pendingClone: { readonly projectId: string; readonly hostId?: EnvironmentId } | null = null;

/**
 * Asks the project page to clone the project's repositories onto a computer, starting on
 * `hostId` when given. Like a brief request, it waits for that project's page to mount.
 */
export function requestLibraryClone(projectId: string, hostId?: EnvironmentId) {
  pendingClone = { projectId, ...(hostId ? { hostId } : {}) };
  window.dispatchEvent(new Event(CLONE_EVENT));
}

/** Taken once by the page of the project the last request named. */
export function takeLibraryClone(projectId: string) {
  if (pendingClone?.projectId !== projectId) return null;
  const request = pendingClone;
  pendingClone = null;
  return request;
}

export function dropLibraryClone(projectId: string) {
  if (pendingClone?.projectId === projectId) pendingClone = null;
}

export function onLibraryClone(listener: () => void) {
  window.addEventListener(CLONE_EVENT, listener);
  return () => window.removeEventListener(CLONE_EVENT, listener);
}

const HISTORY_SEARCH_EVENT = "loom:library:search-history";
// The empty project id addresses the shared search field on the Projects page.
let pendingHistorySearch: { readonly projectId: string; readonly query: string } | null = null;

/**
 * Asks a history search field to take focus: the project page's field for `projectId`, or the
 * projects page's field for every project. A field already showing takes it at once; otherwise
 * the request waits for that page to mount.
 */
export function requestLibraryHistorySearch(projectId?: string, query = "") {
  pendingHistorySearch = { projectId: projectId ?? "", query };
  window.dispatchEvent(new Event(HISTORY_SEARCH_EVENT));
}

/** Taken once by the field whose scope the last request named. */
export function takeLibraryHistorySearch(projectId?: string) {
  if (pendingHistorySearch?.projectId !== (projectId ?? "")) return null;
  const request = pendingHistorySearch;
  pendingHistorySearch = null;
  return request;
}

export function onLibraryHistorySearch(listener: () => void) {
  window.addEventListener(HISTORY_SEARCH_EVENT, listener);
  return () => window.removeEventListener(HISTORY_SEARCH_EVENT, listener);
}
