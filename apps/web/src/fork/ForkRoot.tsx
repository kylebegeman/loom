import type { ComponentType } from "react";

import { ForkGlobalShortcuts } from "./keybindings/ForkGlobalShortcuts";
import { InspectorCommandsHost } from "./thread-inspector/InspectorCommandsHost";

/** Components mounted once in the authenticated app shell. One line per packet. */
const FORK_ROOT_COMPONENTS: ReadonlyArray<{
  readonly id: string;
  readonly Component: ComponentType;
}> = [
  { id: "shortcuts", Component: ForkGlobalShortcuts },
  { id: "thread-inspector-commands", Component: InspectorCommandsHost },
  // { id: "snippets-dialog", Component: SnippetsDialogHost },
];

export function ForkRoot() {
  return (
    <>
      {FORK_ROOT_COMPONENTS.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </>
  );
}
