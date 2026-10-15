import { readLibraryAuthorityId } from "./state";

export type LibraryAction = "create-project" | "import-folder" | "new-conversation";
const EVENT = "loom:library:action";

/** Return false when the Library has not been configured so existing local entrypoints still work. */
export function openLibraryAction(action: LibraryAction) {
  if (!readLibraryAuthorityId()) return false;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: action }));
  return true;
}

export function onLibraryAction(listener: (action: LibraryAction) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<LibraryAction>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
