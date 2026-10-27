import { create } from "zustand";

import type { LibraryAction, LibraryConversationDefaults } from "./actions";

export interface LibraryPaletteSession {
  readonly id: number;
  readonly open: boolean;
  readonly action: LibraryAction;
  readonly projectId?: string | undefined;
  readonly defaults?: LibraryConversationDefaults | undefined;
  /** The project only leads the chooser; its settings open once the user picks it. */
  readonly suggest?: boolean | undefined;
}

// Palette shortcuts read the session when a key is pressed, outside React.
export const useLibraryPaletteStore = create<{ readonly session: LibraryPaletteSession | null }>(
  () => ({ session: null }),
);

export function isLibraryPaletteOpen(): boolean {
  return useLibraryPaletteStore.getState().session?.open === true;
}

export function closeLibraryPalette(): void {
  useLibraryPaletteStore.setState(({ session }) => ({
    session: session ? { ...session, open: false } : null,
  }));
}

/** Keeps the current page through the popup's exit transition. */
export function finishLibraryPaletteClose(): void {
  useLibraryPaletteStore.setState(({ session }) => ({ session: session?.open ? session : null }));
}

/** A Library action that needs a Library first. The connect dialog runs it once one is chosen. */
export type LibraryActionRequest = Omit<LibraryPaletteSession, "id" | "open">;

/**
 * `computers` connects a Library for its own sake, on a computer that only reaches others, then
 * lists the computers the Library knows instead of running an action.
 */
type LibraryConnectRequest = LibraryActionRequest | "computers";

export const useLibraryConnectStore = create<{ readonly pending: LibraryConnectRequest | null }>(
  () => ({ pending: null }),
);

export function requestLibraryConnect(request: LibraryConnectRequest): void {
  closeLibraryPalette();
  useLibraryConnectStore.setState({ pending: request });
}
