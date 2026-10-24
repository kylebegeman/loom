import { useBlocker } from "@tanstack/react-router";
import { useRef, type ReactNode } from "react";
import { ensureLocalApi } from "~/localApi";

/**
 * Keeps unsaved work in a full-page editor from vanishing: leaving the editor inside the app asks
 * first, and closing the window warns. Moves that keep the editor open, such as opening a dialog
 * that lives in the URL, pass through. Call `leave` for a move the editor makes itself, such as
 * after saving or on Cancel, so it is never asked about.
 */
export function useUnsavedChangesGuard({
  dirty,
  message,
  staysOpen,
}: {
  readonly dirty: boolean;
  readonly message: string;
  /** Whether a location still shows this editor. */
  readonly staysOpen: (next: { readonly pathname: string; readonly search: unknown }) => boolean;
}) {
  const leaving = useRef(false);
  useBlocker({
    shouldBlockFn: async ({ next }) => {
      if (leaving.current) {
        leaving.current = false;
        return false;
      }
      if (staysOpen(next)) return false;
      return !(await ensureLocalApi().dialogs.confirm(message));
    },
    disabled: !dirty,
    enableBeforeUnload: dirty,
  });
  return {
    leave: (go: () => void) => {
      leaving.current = dirty;
      go();
    },
  };
}

/**
 * The action bar a full-page editor keeps in reach: pinned to the bottom of the page as it
 * scrolls, on a neutral hairline. `status` says what saving will do or what still blocks it.
 */
export function LibraryEditorBar({
  status,
  children,
}: {
  readonly status?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border bg-background py-3">
      <div className="min-w-0 flex-1 text-xs text-muted-foreground">{status}</div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}
