import { useUiStateStore } from "~/uiStateStore";
const EVENT = "loom:project-navigation-thread-scope";

/** Project home can scope the existing thread navigator without starting a new draft. */
export function requestProjectThreadView(projectKey: string) {
  useUiStateStore.getState().setSidebarProjectScopeKeys([projectKey]);
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: projectKey }));
}

export function onProjectThreadView(listener: (projectKey: string) => void) {
  const handle = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail === "string") listener(event.detail);
  };
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}
