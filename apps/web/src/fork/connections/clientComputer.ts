import type { DesktopBridge } from "@t3tools/contracts";

type LocalEnvironmentBridge = Pick<
  DesktopBridge,
  "getLocalEnvironmentEnabled" | "setLocalEnvironmentEnabled"
>;
type IntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Survives the restart that turning off this computer's server triggers, and is read only once.
const CONNECT_LIBRARY_AFTER_RESTART_KEY = "loom:client-computer:connect-library:v1";

/** Only the desktop app can stop running agents on its own computer, and only while it does. */
export function canChooseClientComputer(
  bridge: LocalEnvironmentBridge | undefined = window.desktopBridge,
): boolean {
  return (
    bridge?.setLocalEnvironmentEnabled !== undefined &&
    bridge.getLocalEnvironmentEnabled?.() !== false
  );
}

/** Turns off this computer's server, which restarts the app, and asks to connect a Library after. */
export async function chooseClientComputer(
  bridge:
    | Pick<LocalEnvironmentBridge, "setLocalEnvironmentEnabled">
    | undefined = window.desktopBridge,
  storage: IntentStorage = window.localStorage,
): Promise<void> {
  const setEnabled = bridge?.setLocalEnvironmentEnabled;
  if (!setEnabled) throw new Error("Only the desktop app can stop running agents here.");
  try {
    storage.setItem(CONNECT_LIBRARY_AFTER_RESTART_KEY, "1");
  } catch {
    // Without storage the user connects a Library from the home screen instead.
  }
  try {
    await setEnabled(false);
  } catch (cause) {
    forgetIntent(storage);
    throw cause;
  }
}

/** True once after choosing to only reach other computers. */
export function takeLibraryConnectAfterRestart(
  storage: IntentStorage = window.localStorage,
): boolean {
  try {
    if (storage.getItem(CONNECT_LIBRARY_AFTER_RESTART_KEY) === null) return false;
  } catch {
    return false;
  }
  // An intent that cannot be cleared would reopen the dialog on every launch.
  return forgetIntent(storage);
}

function forgetIntent(storage: IntentStorage): boolean {
  try {
    storage.removeItem(CONNECT_LIBRARY_AFTER_RESTART_KEY);
    return true;
  } catch {
    return false;
  }
}
