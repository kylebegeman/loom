import { RegistryContext } from "@effect/atom-react";
import { useContext, useEffect } from "react";

import { supportsLibraryPushBuild } from "./libraryPushBuild";
import { startLibraryPushSync } from "./libraryPushSync";

/** Mounted once for the app's lifetime. A build without Library push mounts nothing at all. */
export function LibraryPushCoordinator() {
  return supportsLibraryPushBuild() ? <LibraryPushSync /> : null;
}

/** Subscribes through the registry, so Library traffic never re-renders the app root. */
function LibraryPushSync() {
  const registry = useContext(RegistryContext);
  useEffect(() => startLibraryPushSync(registry), [registry]);
  return null;
}
