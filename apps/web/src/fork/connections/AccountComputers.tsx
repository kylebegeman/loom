import { useAtomValue } from "@effect/atom-react";
import { squashLibraryCommandFailure } from "@t3tools/client-runtime/fork";
import { ACCOUNT_COMPUTERS_FEATURE, type AccountComputerStatus } from "@t3tools/contracts/fork";
import { randomUUID } from "~/lib/utils";
import { useState } from "react";
import { SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { requestConfirmDialog } from "~/confirmDialog";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { projectLibrary, useLibraryAuthority } from "../project-library/state";

export function AccountComputers() {
  const authority = useLibraryAuthority();
  const environmentId = authority.authorityId;
  const available =
    authority.connected && authority.info.data?.features?.includes(ACCOUNT_COMPUTERS_FEATURE);
  const canRemove = useAtomValue(
    projectLibrary.removeAccountComputer.permissionAtom(environmentId),
  );
  const computers = useEnvironmentQuery(
    available && environmentId !== null
      ? projectLibrary.accountComputers({ environmentId, input: {} })
      : null,
  );
  const remove = useAtomCommand(projectLibrary.removeAccountComputer, { reportFailure: false });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ authorityId: string; message: string } | null>(null);
  if (!available || environmentId === null) return null;
  const endAccess = async (computer: AccountComputerStatus) => {
    if (!canRemove || pending !== null) return;
    if (
      computer.state === "active" &&
      !(await requestConfirmDialog(
        `Remove ${computer.label} from your account? This ends its publishing and remote account access. Saved conversations and projects stay in the Library. Add the computer again to reconnect it.`,
        { variant: "destructive" },
      ))
    )
      return;
    setPending(computer.environmentId);
    setError(null);
    const result = await remove({
      environmentId,
      input: {
        environmentId: computer.environmentId,
        membershipRevision: computer.membershipRevision,
        requestId: randomUUID(),
      },
    });
    if (result._tag === "Failure") {
      const cause = squashLibraryCommandFailure(result);
      setError({
        authorityId: environmentId,
        message:
          cause instanceof Error
            ? cause.message
            : "The computer could not be removed. Refresh and try again.",
      });
    }
    computers.refresh();
    setPending(null);
  };
  return (
    <SettingsSection title="Account computers" id="library-computers">
      <p className="px-4 py-3 text-sm text-muted-foreground">
        Remove a retired or lost computer here. Your saved work stays in the Library.
      </p>
      {error?.authorityId === environmentId || computers.error ? (
        <p role="alert" className="px-4 pb-3 text-sm text-destructive">
          {error?.authorityId === environmentId ? error.message : computers.error}
        </p>
      ) : null}
      <div className="px-4 pb-3">
        <Button size="sm" variant="outline" onClick={computers.refresh}>
          {computers.data === null ? "Load computers" : "Refresh computers"}
        </Button>
      </div>
      {computers.data?.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">
          No computers added. Add a computer to use it from your other devices.
        </p>
      ) : null}
      {computers.data?.map((computer) => (
        <div
          key={computer.environmentId}
          className="flex flex-wrap items-start justify-between gap-3 border-t border-border/60 px-4 py-3"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium wrap-anywhere">{computer.label}</p>
            <p className="text-xs text-muted-foreground">
              {computer.state === "active"
                ? "Account access enabled"
                : computer.state === "removing"
                  ? "Account access ended. Cleanup pending."
                  : "Removed. Saved work kept."}
            </p>
            {computer.state === "removing" ? (
              <p className="text-xs text-muted-foreground">
                {computer.publishingEnded ? "Publishing ended." : "Publishing cleanup pending."}{" "}
                {computer.routeRemoved ? "Remote route removed." : "Remote route cleanup pending."}{" "}
                {computer.directoryRemoved
                  ? "Registration removed."
                  : "Registration cleanup pending."}
              </p>
            ) : null}
            {computer.detail ? <p className="text-sm text-destructive">{computer.detail}</p> : null}
          </div>
          {computer.state !== "removed" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!canRemove || pending !== null}
              aria-label={`${computer.state === "removing" ? "Retry cleanup for" : "Remove"} ${computer.label}`}
              onClick={() => void endAccess(computer)}
            >
              {pending === computer.environmentId
                ? "Removing..."
                : computer.state === "removing"
                  ? "Retry cleanup"
                  : "Remove computer"}
            </Button>
          ) : null}
        </div>
      ))}
    </SettingsSection>
  );
}
