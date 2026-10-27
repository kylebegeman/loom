import { useNavigate } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { openLibraryAction } from "./actions";
import { LibraryDialog } from "./LibraryControls";
import { useLibraryConnectStore } from "./libraryPaletteSession";
import { LIBRARY_SETUP_DESCRIPTION, LibrarySetup } from "./LibrarySetup";

/** The Library's other computers in Settings > Computers, where a new client connects them. */
export const LIBRARY_COMPUTERS_TARGET = "library-computers";

/** Connecting a Library is a form of its own: a palette panel clips anything taller than its rows. */
function LibraryConnectDialog({
  onConnected,
  onClose,
}: {
  readonly onConnected: () => void;
  readonly onClose: () => void;
}) {
  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Connect your Library"
      description={LIBRARY_SETUP_DESCRIPTION}
      actions={
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <LibrarySetup heading={false} showConnectionsLink={false} onSelected={onConnected} />
    </LibraryDialog>
  );
}

/** Shows the connect dialog for a Library action that needs one, then runs that action. */
export function LibraryConnectHost() {
  const pending = useLibraryConnectStore((state) => state.pending);
  const navigate = useNavigate();
  if (!pending) return null;
  const close = () => useLibraryConnectStore.setState({ pending: null });
  return (
    <LibraryConnectDialog
      onClose={close}
      onConnected={() => {
        close();
        if (pending === "computers") {
          void navigate({ to: "/settings/connections", hash: LIBRARY_COMPUTERS_TARGET });
          return;
        }
        openLibraryAction(
          pending.action,
          pending.projectId,
          pending.defaults,
          pending.suggest ? { suggest: true } : undefined,
        );
      }}
    />
  );
}
