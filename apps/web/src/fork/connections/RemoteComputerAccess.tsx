import { AuthAccessReadScope, sessionGrantsScope, type EnvironmentId } from "@t3tools/contracts";
import { AUTH_SCOPE_OPTIONS } from "@t3tools/shared/authScopeOptions";
import { authEnvironment } from "~/state/auth";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";

/** Access is always read from the selected computer, never the current host. */
export function RemoteComputerAccess({
  environmentId,
  connected,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
}) {
  const canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const access = useEnvironmentQuery(
    connected && canRead ? authEnvironment.accessChanges({ environmentId, input: null }) : null,
  );
  const snapshot = access.data?.type === "snapshot" ? access.data.payload : null;
  const devices =
    snapshot?.clientSessions.toSorted(
      (a, b) => Number(b.current) - Number(a.current) || Number(b.connected) - Number(a.connected),
    ) ?? [];
  return (
    <section className="space-y-2" aria-label="Devices with access">
      <h3 className="text-xs font-medium">Devices with access</h3>
      {!connected ? (
        <p className="text-xs text-muted-foreground">
          Connect this computer to view devices with access.
        </p>
      ) : !canRead ? (
        <p className="text-xs text-muted-foreground">
          This connection needs View access permission to list devices.
        </p>
      ) : access.error ? (
        <p role="alert" className="text-xs text-destructive">
          Could not load devices with access. {access.error}
        </p>
      ) : snapshot === null ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading devices...
        </p>
      ) : devices.length === 0 ? (
        <p className="text-xs text-muted-foreground">No paired devices.</p>
      ) : (
        <ul className="space-y-2">
          {devices.map((device) => {
            // oxlint-disable-next-line t3code/no-rpc-permission-bypass -- AuthClientSession.client is display metadata, not an RPC connection.
            const { client: metadata } = device;
            const permissions = AUTH_SCOPE_OPTIONS.filter(({ scope }) =>
              sessionGrantsScope({ ...device, authenticated: true }, scope),
            );
            return (
              <li key={device.sessionId} className="rounded-lg bg-muted/30 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium">
                    {metadata.label ??
                      ([metadata.os, metadata.browser].filter(Boolean).join(" · ") ||
                        device.subject)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {device.current ? "This device" : device.connected ? "Connected" : "Offline"}
                  </span>
                </div>
                <details className="mt-1 text-xs text-muted-foreground">
                  <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
                    {permissions.length} permissions
                  </summary>
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {permissions.map(({ scope, title }) => (
                      <li key={scope}>{title}</li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      {snapshot && snapshot.pairingLinks.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {snapshot.pairingLinks.length} active pairing{" "}
          {snapshot.pairingLinks.length === 1 ? "link" : "links"}
        </p>
      ) : null}
    </section>
  );
}
