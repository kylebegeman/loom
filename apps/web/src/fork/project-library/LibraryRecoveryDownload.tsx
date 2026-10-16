import { useState } from "react";
import { AuthOrchestrationReadScope, type EnvironmentId } from "@t3tools/contracts";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironmentScope } from "~/state/session";
import { libraryRecoveryAccess } from "~/rpc/libraryAssets";
import { formatBytes } from "~/lib/formatBytes";
import { isElectron } from "~/env";

export function LibraryRecoveryDownload({
  authorityId,
  connected,
  copy,
}: {
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly copy: LibraryWorkingCopy;
}) {
  const access = useAtomCommand(libraryRecoveryAccess, { reportFailure: false });
  const canRead = useEnvironmentScope(authorityId, AuthOrchestrationReadScope);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recovery = copy.recovery;
  if (!recovery) return null;
  const download = async () => {
    if (busy) return;
    const target = isElectron ? null : window.open("about:blank", "_blank");
    if (target) target.opener = null;
    setBusy(true);
    setError(null);
    try {
      const result = await access({
        environmentId: authorityId,
        input: {
          sourceEnvironmentId: copy.environmentId,
          copyId: copy.id,
          sha256: recovery.sha256,
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      if (isElectron) {
        if (!(await window.desktopBridge?.openExternal(result.value)))
          throw new Error("Could not download the recovery archive in your browser.");
      } else if (target) target.location.replace(result.value);
      else throw new Error("Allow this site's pop-ups, then try downloading the archive again.");
    } catch (cause) {
      target?.close();
      setError(cause instanceof Error ? cause.message : "Could not download the recovery archive.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <Button
        size="xs"
        variant="outline"
        disabled={busy || !connected || !canRead}
        onClick={() => void download()}
      >
        {busy ? "Preparing download..." : "Download recovery archive"}
      </Button>
      <p className="text-xs text-muted-foreground">
        {formatBytes(recovery.byteLength)} · Verified{" "}
        {new Date(recovery.verifiedAt).toLocaleString()}. Extract the archive, then review it with
        Use a folder you already have before starting new work.
      </p>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Archive checksum</summary>
        <p className="mt-1 break-all font-mono">SHA256: {recovery.sha256}</p>
      </details>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
