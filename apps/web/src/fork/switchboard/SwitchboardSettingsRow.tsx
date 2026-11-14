import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import type { SwitchboardComputer } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { useNowMinute } from "~/hooks/useNowMinute";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { formatRelativeElapsed } from "~/timestampFormat";
import { isSwitchboardAvailabilityUnknown, useSwitchboardStatus } from "./switchboardLimits";
import {
  describeSwitchboardRoute,
  switchboardReconnect,
  switchboardRevokeComputer,
  switchboardRouteQuery,
} from "./switchboardRoute";

const HUB_COMPUTERS_NOTE =
  "Each computer holds its own credential. Revoking one makes it fetch a new credential at its next check. To keep a computer out, remove it from your account.";

// Outside the component because React Compiler cannot lower `try`/`finally`.
async function runRouteCommand<W, A, E>(
  command: AtomCommand<W, A, E>,
  input: W,
  title: string,
  setBusy: (busy: boolean) => void,
  settled: () => void,
) {
  setBusy(true);
  try {
    const result = await command.run(appAtomRegistry, input);
    if (result._tag === "Failure") throw Cause.squash(result.cause);
  } catch (caught) {
    toastManager.add({
      type: "error",
      title,
      description: caught instanceof Error ? caught.message : "Try again in a moment.",
    });
  } finally {
    setBusy(false);
    settled();
  }
}

const lastUsed = (computer: SwitchboardComputer, now: number) => {
  if (computer.lastUsedAt === null) return `Ledger name ${computer.device}`;
  const { value, suffix } = formatRelativeElapsed(Math.max(0, now - computer.lastUsedAt));
  return `Ledger name ${computer.device}. Used ${suffix === null ? value : `${value} ${suffix}`}.`;
};

/** The Switchboard switch, shown with the usage hubs since Switchboard is one. */
export function SwitchboardSettingsRow({
  environmentId,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly readOnly: boolean;
}) {
  const enabled = useEnvironmentSettings(environmentId, (settings) => settings.switchboardEnabled);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const limits = useSwitchboardStatus(enabled, environmentId);
  const routeAtom = switchboardRouteQuery({ environmentId, input: {} });
  const routeResult = useAtomValue(routeAtom);
  const refreshRoute = useAtomRefresh(routeAtom);
  const canReconnect = useAtomValue(switchboardReconnect.permissionAtom(environmentId));
  const canRevoke = useAtomValue(switchboardRevokeComputer.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  // The shared clock is a UTC minute written without its zone.
  const now = Date.parse(`${useNowMinute()}Z`);

  const route = Option.getOrNull(AsyncResult.value(routeResult));
  const summary = route === null ? null : describeSwitchboardRoute(route, now);
  const limitsNote =
    limits.availability === "unconfigured"
      ? " No Switchboard controller is configured, so every model stays selectable. Set LOOM_SWITCHBOARD_CONTROLLER_URL on the server to show availability."
      : isSwitchboardAvailabilityUnknown(limits)
        ? " Switchboard cannot report model availability right now, so every model stays selectable."
        : "";
  const reconnect = () =>
    void runRouteCommand(
      switchboardReconnect,
      { environmentId, input: {} },
      "Unable to reconnect Switchboard",
      setBusy,
      refreshRoute,
    );
  const revoke = (computer: SwitchboardComputer) =>
    void runRouteCommand(
      switchboardRevokeComputer,
      { environmentId, input: { environmentId: computer.environmentId } },
      `Unable to revoke ${computer.label}`,
      setBusy,
      refreshRoute,
    );

  return (
    <SettingsRow
      id="switchboard"
      title="Route through Switchboard"
      description={`Send Claude and Codex through your account's Switchboard, which picks the account per request. The picker shows one Claude and one Codex. Running sessions keep their route.${limitsNote}`}
      status={
        summary === null ? (
          AsyncResult.isFailure(routeResult) ? (
            "Unable to read this computer's Switchboard route."
          ) : undefined
        ) : (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={summary.attention ? "text-warning-foreground" : undefined}>
              {summary.text}
            </span>
            {summary.action !== null && (
              <Button
                size="xs"
                variant="outline"
                disabled={busy || readOnly || !canReconnect}
                onClick={reconnect}
              >
                {summary.action === "reconnect" ? "Reconnect" : "Try again"}
              </Button>
            )}
          </span>
        )
      }
      control={
        <Switch
          aria-label="Route through Switchboard"
          checked={enabled}
          disabled={readOnly}
          onCheckedChange={(checked) => updateSettings({ switchboardEnabled: Boolean(checked) })}
        />
      }
    >
      {route?.computers !== undefined && (
        <div className="flex flex-col gap-2 pt-1 pb-3">
          <p className="max-w-2xl text-pretty text-xs text-muted-foreground">
            {HUB_COMPUTERS_NOTE}
          </p>
          {route.computers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No other computers route through this one yet.
            </p>
          ) : (
            <ul className="flex flex-col">
              {route.computers.map((computer) => (
                <li
                  key={computer.environmentId}
                  className="flex min-w-0 items-center justify-between gap-3 border-b border-border/60 py-2 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{computer.label}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {lastUsed(computer, now)}
                    </span>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || readOnly || !canRevoke}
                    // Every row repeats the button, so a screen reader needs the computer in the name.
                    aria-label={`Revoke ${computer.label}`}
                    onClick={() => revoke(computer)}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SettingsRow>
  );
}
