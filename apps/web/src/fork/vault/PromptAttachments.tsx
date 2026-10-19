import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { type EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  attachVaultPrompt,
  readVaultPrompt,
  removeVaultPromptAttachment,
  type VaultProfile,
  type VaultProfilePreview,
} from "@t3tools/contracts/fork";
import {
  createVaultProfileAtoms,
  supportsLoomFeature,
  vaultProfileBindingMessage,
} from "@t3tools/client-runtime/fork";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import { connectionAtomRuntime } from "~/connection/runtime";
import { useServerConfigs } from "~/state/entities";
import { useEnvironmentScope } from "~/state/session";
import { AuthAccessReadScope } from "@t3tools/contracts";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { VaultReferencePicker } from "./ReferencePicker";
import { runVault } from "./state";
const profiles = createVaultProfileAtoms(connectionAtomRuntime);
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Vault review failed. Refresh and try again.";
export function VaultPromptAttachments(props: {
  environmentId: EnvironmentId;
  projectId: string | null;
  threadId?: string | null;
  prompt: string;
  onChange: (text: string) => void;
  disabled?: boolean;
}) {
  const configs = useServerConfigs(),
    canRead = useEnvironmentScope(props.environmentId, AuthAccessReadScope);
  const [open, setOpen] = useState(false);
  if (
    !supportsLoomFeature(
      configs.get(props.environmentId)?.environment.capabilities,
      "vault-prompt-attachments",
    )
  )
    return null;
  const parsed = readVaultPrompt(props.prompt);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={props.disabled || !props.projectId || !canRead}
        onClick={() => setOpen(true)}
      >
        Vault attachments{parsed.attachments.length ? ` (${parsed.attachments.length})` : ""}
      </Button>
      {!parsed.valid ? (
        <p role="alert" className="text-xs">
          Repair invalid Vault links before sending.
        </p>
      ) : null}
      {parsed.attachments.some((a) => a.environmentId !== props.environmentId) ? (
        <p role="alert" className="text-xs">
          Replace Vault links for this computer.
        </p>
      ) : null}
      {open && props.projectId ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Vault launch attachments</DialogTitle>
              <DialogDescription>
                Attach references without credential values. Profiles require full-access/default
                agent runs. Every run checks current access; references alone require inspection,
                not permission to use a credential.
              </DialogDescription>
            </DialogHeader>
            <PromptEditor
              key={`${props.environmentId}:${props.projectId}`}
              {...props}
              projectId={ProjectId.make(props.projectId)}
              threadId={props.threadId ? ThreadId.make(props.threadId) : null}
            />
          </DialogPopup>
        </Dialog>
      ) : null}
    </div>
  );
}
function PromptEditor(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  threadId?: ThreadId | null;
  prompt: string;
  onChange: (text: string) => void;
  disabled?: boolean;
}) {
  const atom = profiles.list({
      environmentId: props.environmentId,
      input: { projectId: props.projectId },
    }),
    result = useAtomValue(atom),
    snapshot = Option.getOrNull(AsyncResult.value(result));
  const [review, setReview] = useState<{
      profile: VaultProfile;
      preview: VaultProfilePreview;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const parsed = readVaultPrompt(props.prompt);
  const stale = result.waiting || result._tag === "Failure",
    disabled = !!props.disabled || busy;
  const preview = async (profile: VaultProfile) => {
    setBusy(true);
    setError(null);
    setReview(null);
    try {
      setReview({
        profile,
        preview: await runVault(profiles.preview, {
          environmentId: props.environmentId,
          input: { projectId: props.projectId, profile, threadId: props.threadId ?? null },
        }),
      });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto px-6 pb-6">
      <p className="text-sm">
        Links are saved with this prompt and shown in the transcript. Delete a link or remove it
        below to detach it. Profile edits require review and attachment of the new version. A new
        scheduled thread needs project grants.
      </p>
      {!parsed.valid ? (
        <p role="alert" className="text-sm">
          A Vault link is invalid or duplicated. Edit the prompt to repair it.
        </p>
      ) : null}
      {parsed.attachments.map((a) => (
        <div
          key={a.start}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
        >
          <p className="break-words text-sm">
            {a.kind}: {a.label}
            {a.kind === "profile" ? ` · Version ${a.version}` : ""}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => props.onChange(removeVaultPromptAttachment(props.prompt, a))}
          >
            Remove {a.label}
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setReview(null);
          appAtomRegistry.refresh(atom);
        }}
      >
        Refresh launch profiles
      </Button>
      {result.waiting ? <p role="status">Loading launch profiles…</p> : null}
      {result._tag === "Failure" ? <p role="alert">{message(Cause.squash(result.cause))}</p> : null}
      {snapshot?.profiles
        .filter((p) => p.state === "active")
        .map((p) => (
          <Button
            key={p.id}
            size="sm"
            variant="outline"
            disabled={disabled || stale}
            onClick={() => void preview(p)}
          >
            Review {p.label}
            {snapshot.activeProfileId === p.id ? " (project default)" : ""}
          </Button>
        ))}
      {snapshot?.profiles.every((p) => p.state !== "active") ? (
        <p className="text-sm">No active project profiles. Create one in Vault project profiles.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {review ? (
        <section
          aria-label="Launch profile review"
          className="flex flex-col gap-2 rounded-md bg-muted p-3"
        >
          <p className="text-sm font-medium">
            {review.profile.label} · Version {review.profile.version}
          </p>
          {review.preview.bindings.map((b) => (
            <p key={b.name} className="break-words text-sm">
              {b.name}: {vaultProfileBindingMessage(b.state)}
              {b.destination ? ` · ${b.destination}` : ""}
            </p>
          ))}
          {!props.threadId ? (
            <p className="text-sm">Thread grants will be checked when the run starts.</p>
          ) : null}
          <Button
            size="sm"
            disabled={
              disabled ||
              stale ||
              !parsed.valid ||
              !review.preview.bindings.every((b) => b.state === "ready" || b.state === "unchecked")
            }
            onClick={() => {
              props.onChange(
                attachVaultPrompt(
                  props.prompt,
                  {
                    kind: "profile",
                    environmentId: props.environmentId,
                    id: review.profile.id,
                    version: review.profile.version,
                  },
                  review.profile.label,
                ),
              );
              setReview(null);
            }}
          >
            Attach reviewed profile
          </Button>
        </section>
      ) : null}
      <VaultReferencePicker
        environmentId={props.environmentId}
        disabled={
          disabled ||
          !parsed.valid ||
          parsed.attachments.filter((a) => a.kind === "reference").length >= 16
        }
        onSelect={(ref) =>
          props.onChange(
            attachVaultPrompt(
              props.prompt,
              { kind: "reference", environmentId: props.environmentId, id: ref.item.id },
              ref.item.label,
            ),
          )
        }
      />
    </div>
  );
}
