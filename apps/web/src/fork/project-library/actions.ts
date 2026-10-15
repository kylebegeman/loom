export type LibraryAction = "create-project" | "import-folder" | "new-conversation";
const EVENT = "loom:library:action";

/** Every entry point opens the same flow, including first-time Library setup. */
export function openLibraryAction(action: LibraryAction, projectId?: string) {
  window.dispatchEvent(
    new CustomEvent(EVENT, { detail: projectId ? { action, projectId } : action }),
  );
  return true;
}

export function onLibraryAction(listener: (action: LibraryAction, projectId?: string) => void) {
  const handler = (event: Event) => {
    const detail = (
      event as CustomEvent<LibraryAction | { action: LibraryAction; projectId: string }>
    ).detail;
    if (typeof detail === "string") listener(detail);
    else listener(detail.action, detail.projectId);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
