export type LibraryAction = "create-project" | "import-folder" | "new-conversation";
const EVENT = "loom:library:action";

/** Every entry point opens the same flow, including first-time Library setup. */
export function openLibraryAction(action: LibraryAction) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: action }));
  return true;
}

export function onLibraryAction(listener: (action: LibraryAction) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<LibraryAction>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
