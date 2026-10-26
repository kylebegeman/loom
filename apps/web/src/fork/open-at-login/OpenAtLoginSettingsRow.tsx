import type { DesktopOpenAtLoginState, DesktopOpenAtLoginStatus } from "@t3tools/contracts/fork";
import { useEffect, useState } from "react";

import { SettingsRow } from "~/components/settings/settingsLayout";
import { searchableSetting } from "~/components/settings/settingsSearch";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";

const DESCRIPTIONS: Record<Exclude<DesktopOpenAtLoginStatus, "unsupported">, string> = {
  on: "Loom opens when you log in, so this computer's agents and connections come back after a restart.",
  off: "Loom stays closed until you open it. After a restart, this computer is offline until then.",
  "needs-approval":
    "Loom is set to open at login, but the system's login item settings are blocking it. Allow Loom there.",
  failed: "Loom could not update its login item. Try turning this off and on again.",
  "not-installed":
    "Only the installed app opens at login. Move Loom to Applications to use this setting.",
};

/** The open at login switch for the installed desktop app. */
export function OpenAtLoginSettingsRow() {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge?.openAtLogin;
  const [state, setState] = useState<DesktopOpenAtLoginState | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge
      .getState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const change = (enabled: boolean) => {
    if (!bridge || pending) return;
    setPending(true);
    void bridge
      .setEnabled(enabled)
      .then(setState)
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not change open at login",
            description: error instanceof Error ? error.message : "Something went wrong.",
          }),
        );
      })
      .finally(() => setPending(false));
  };

  if (!bridge || !state || state.status === "unsupported") return null;
  const blocked = state.status === "needs-approval" || state.status === "failed";

  return (
    <SettingsRow
      {...searchableSetting("open-at-login")}
      description={DESCRIPTIONS[state.status]}
      control={
        <>
          {blocked ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void bridge.openSystemSettings().catch(() => undefined)}
            >
              Open system settings
            </Button>
          ) : null}
          <Switch
            checked={state.enabled}
            disabled={pending || state.status === "not-installed"}
            onCheckedChange={change}
            aria-label="Open at login"
          />
        </>
      }
    />
  );
}
