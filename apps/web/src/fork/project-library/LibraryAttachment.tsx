import { useState } from "react";
import {
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type ChatAttachment,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironmentScope } from "~/state/session";
import { libraryAssetAccess } from "~/rpc/libraryAssets";
import { isElectron } from "~/env";

export function LibraryAttachment({
  authorityId,
  sourceEnvironmentId,
  attachment,
}: {
  readonly authorityId: EnvironmentId;
  readonly sourceEnvironmentId: EnvironmentId;
  readonly attachment: ChatAttachment;
}) {
  const access = useAtomCommand(libraryAssetAccess, { reportFailure: false });
  const canRead = useEnvironmentScope(authorityId, AuthOrchestrationReadScope);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    if (busy) return;
    const target = isElectron ? null : window.open("about:blank", "_blank");
    if (target) target.opener = null;
    setBusy(true);
    setError(null);
    try {
      const result = await access({
        environmentId: authorityId,
        input: { sourceEnvironmentId, attachmentId: attachment.id },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      if (isElectron) {
        if (!(await window.desktopBridge?.openExternal(result.value)))
          throw new Error("Could not open the attachment in your browser.");
      } else if (target) target.location.replace(result.value);
      else throw new Error("Allow this site's pop-ups, then try opening the attachment again.");
    } catch (cause) {
      target?.close();
      setError(cause instanceof Error ? cause.message : "Could not open this saved attachment.");
    } finally {
      setBusy(false);
    }
  };
  const previewImage = async () => {
    setBusy(true);
    setError(null);
    const result = await access({
      environmentId: authorityId,
      input: { sourceEnvironmentId, attachmentId: attachment.id },
    });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not load this image.");
    } else setPreview(result.value);
    setBusy(false);
  };
  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" disabled={busy || !canRead} onClick={() => void open()}>
        {busy ? "Opening..." : attachment.name}
      </Button>
      {attachment.mimeType.startsWith("image/") ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={busy || !canRead}
          onClick={() => {
            if (preview) setPreview(null);
            else void previewImage();
          }}
        >
          {preview ? "Hide image" : "Preview image"}
        </Button>
      ) : null}
      {preview ? (
        <img
          src={preview}
          alt={attachment.name}
          className="max-h-96 max-w-full rounded-md object-contain"
          onError={() => {
            setPreview(null);
            setError("This image is unavailable in the Library. Retry after its history uploads.");
          }}
        />
      ) : null}
      <p className="text-xs text-muted-foreground">
        {attachment.mimeType} · {Math.ceil(attachment.sizeBytes / 1024)} KB
      </p>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
