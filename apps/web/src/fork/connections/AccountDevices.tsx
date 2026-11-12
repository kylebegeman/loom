import { accountClientSessions } from "@t3tools/client-runtime/state/auth";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  type AuthClientSession,
} from "@t3tools/contracts";
import { useState } from "react";
import { SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { requestConfirmDialog } from "~/confirmDialog";
import { authEnvironment } from "~/state/auth";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { useLibraryAuthority } from "../project-library/state";

export function AccountDevices() {
  const authority = useLibraryAuthority();
  const environmentId = authority.authorityId;
  const canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const canWrite = useEnvironmentScope(environmentId, AuthAccessWriteScope);
  const access = useEnvironmentQuery(
    authority.connected && canRead && environmentId !== null
      ? authEnvironment.accessChanges({ environmentId, input: null })
      : null,
  );
  const revoke = useAtomCommand(authEnvironment.revokeClient, { reportFailure: false });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!authority.connected || environmentId === null) return null;
  const sessions = accountClientSessions(
    access.data?.type === "snapshot" ? access.data.payload.clientSessions : [],
  );
  const endAccess = async (session: AuthClientSession) => {
    if (!canWrite || pending !== null) return;
    // oxlint-disable-next-line t3code/no-rpc-permission-bypass -- AuthClientSession.client holds device metadata.
    const { client: device } = session;
    if (
      !(await requestConfirmDialog(
        `End account access for ${device.label ?? device.os ?? device.deviceType}? It will need to sign in again. Your computers and saved work stay in your account. An already authenticated external connection may continue until it ends.`,
        { variant: "destructive" },
      ))
    )
      return;
    setPending(session.sessionId);
    setError(null);
    const result = await revoke({ environmentId, input: { sessionId: session.sessionId } });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(
        cause instanceof Error
          ? cause.message
          : "Access could not be ended. Refresh and try again.",
      );
    }
    setPending(null);
  };
  return (
    <SettingsSection title="Signed-in devices" id="library-devices">
      <p className="px-4 py-3 text-sm text-muted-foreground">
        End access here if a phone or browser is lost. This ends its online access across your
        account’s computers.
      </p>
      {error || access.error ? (
        <p role="alert" className="px-4 pb-3 text-sm text-destructive">
          {error ?? access.error}
        </p>
      ) : null}
      {!canRead ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">
          Your account connection cannot view signed-in devices.
        </p>
      ) : access.data === null ? (
        <div className="px-4 pb-4">
          <Button size="sm" variant="outline" onClick={access.refresh}>
            {access.error ? "Try again" : "Loading devices..."}
          </Button>
        </div>
      ) : sessions.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">No signed-in devices.</p>
      ) : (
        sessions.map((session) => {
          // oxlint-disable-next-line t3code/no-rpc-permission-bypass -- AuthClientSession.client holds device metadata.
          const { client: device } = session;
          return (
            <div
              key={session.sessionId}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium wrap-anywhere">
                  {device.label ?? device.os ?? device.deviceType}
                  {session.current ? " · This device" : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {session.connected ? "Connected" : "Not connected"}
                  {device.browser ? ` · ${device.browser}` : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!canWrite || pending !== null}
                aria-label={`End access for ${device.label ?? device.os ?? device.deviceType}`}
                onClick={() => void endAccess(session)}
              >
                {pending === session.sessionId ? "Ending access..." : "End access"}
              </Button>
            </div>
          );
        })
      )}
    </SettingsSection>
  );
}
