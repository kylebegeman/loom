import { useAtomValue } from "@effect/atom-react";
import { squashLibraryCommandFailure } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ACCOUNT_JOIN_PROMPTS_FEATURE,
  type AccountJoinApproval,
  type AccountJoinPrompt,
} from "@t3tools/contracts/fork";
import { Atom, AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogAction,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { toastManager } from "~/components/ui/toast";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { projectLibrary, useLibraryAuthority } from "../project-library/state";
import {
  cancelJoinApproval,
  joinPasskey,
  startJoinApproval,
  type JoinPasskey,
} from "./joinApproval";

// Requests put off with Later this session; Account lists them to reopen.
const laterAtom = Atom.make<ReadonlyArray<string>>([]).pipe(
  Atom.keepAlive,
  Atom.withLabel("account-join-prompts-later"),
);

const setLater = (requestId: string, later: boolean) => {
  const rest = appAtomRegistry.get(laterAtom).filter((id) => id !== requestId);
  appAtomRegistry.set(laterAtom, later ? [...rest, requestId] : rest);
};

/**
 * Asks the owner to approve a computer that ran `loom join`. The Library sends three codes and
 * only the one on that computer's terminal approves it, so a tap cannot approve the wrong one.
 */
export function AccountJoinPromptHost() {
  const authority = useLibraryAuthority();
  const primaryId = usePrimaryEnvironmentId();
  const allowed = useAtomValue(projectLibrary.respondJoin.permissionAtom(authority.authorityId));
  if (
    authority.authorityId === null ||
    !authority.connected ||
    !allowed ||
    !authority.info.data?.features?.includes(ACCOUNT_JOIN_PROMPTS_FEATURE)
  )
    return null;
  return (
    <JoinPrompts
      key={authority.authorityId}
      authorityId={authority.authorityId}
      passkey={joinPasskey({
        authorityId: authority.authorityId,
        features: authority.info.data.features,
        entry: authority.environment?.entry,
        isPrimary: authority.authorityId === primaryId,
      })}
    />
  );
}

function JoinPrompts({
  authorityId,
  passkey,
}: {
  readonly authorityId: EnvironmentId;
  readonly passkey: JoinPasskey;
}) {
  const prompts = AsyncResult.getOrElse(
    useAtomValue(projectLibrary.joinPrompts({ environmentId: authorityId, input: {} })),
    () => [],
  );
  const later = useAtomValue(laterAtom);
  const prompt = prompts.find((entry) => !later.includes(entry.requestId)) ?? null;
  if (prompt === null) return null;
  return (
    <JoinPromptDialog
      key={prompt.requestId}
      authorityId={authorityId}
      passkey={passkey}
      prompt={prompt}
      onLater={() => setLater(prompt.requestId, true)}
    />
  );
}

/** Requests put off with Later, each with a way to reopen its prompt. */
export function PendingJoinRequests({ authorityId }: { readonly authorityId: EnvironmentId }) {
  const prompts = AsyncResult.getOrElse(
    useAtomValue(projectLibrary.joinPrompts({ environmentId: authorityId, input: {} })),
    () => [],
  );
  const later = useAtomValue(laterAtom);
  const waiting = prompts.filter((prompt) => later.includes(prompt.requestId));
  if (waiting.length === 0) return null;
  return (
    <ul
      aria-label="Waiting computers"
      className="divide-y divide-border/60 border-y border-border/60"
    >
      {waiting.map((prompt) => (
        <li
          key={prompt.requestId}
          className="flex flex-wrap items-center justify-between gap-3 py-3"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium wrap-anywhere">{prompt.label}</p>
            <p className="text-xs text-muted-foreground">Waiting for your approval</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setLater(prompt.requestId, false)}>
            Review
          </Button>
        </li>
      ))}
    </ul>
  );
}

function JoinPromptDialog({
  authorityId,
  passkey,
  prompt,
  onLater,
}: {
  readonly authorityId: EnvironmentId;
  readonly passkey: JoinPasskey;
  readonly prompt: AccountJoinPrompt;
  readonly onLater: () => void;
}) {
  const respond = useAtomCommand(projectLibrary.respondJoin, { reportFailure: false });
  const [sending, setSending] = useState<string | "decline" | null>(null);
  // While the passkey check that approves runs, Later cancels it instead.
  const [confirming, setConfirming] = useState(false);
  const cancelled = useRef(false);
  const expires = new Date(prompt.expiresAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const answer = async (code: string | null) => {
    if (sending !== null) return;
    // Any code may be the terminal's, so each one asks for the passkey before it is sent.
    const proof = code === null || passkey === null ? null : startJoinApproval(passkey);
    setSending(code ?? "decline");
    let approval: AccountJoinApproval | undefined;
    if (proof !== null) {
      cancelled.current = false;
      setConfirming(true);
      try {
        approval = await proof;
      } catch (cause) {
        setConfirming(false);
        setSending(null);
        if (!cancelled.current)
          toastManager.add({
            type: "error",
            title: `Could not approve ${prompt.label}`,
            description: cause instanceof Error ? cause.message : "Approve it again.",
          });
        return;
      }
      setConfirming(false);
    }
    const result = await respond({
      environmentId: authorityId,
      input: { requestId: prompt.requestId, code, ...(approval ? { approval } : {}) },
    });
    setSending(null);
    if (result._tag === "Failure") {
      const cause = squashLibraryCommandFailure(result);
      toastManager.add({
        type: "error",
        title: `Could not answer ${prompt.label}`,
        description: cause instanceof Error ? cause.message : "Try again from this prompt.",
      });
      return;
    }
    if (result.value.state === "approved")
      toastManager.add({
        type: "success",
        title: `${prompt.label} is joining your account`,
        description:
          "It finishes setup on its own and appears on your devices in about a minute. You can remove it from Account at any time.",
      });
    else if (code === null) toastManager.add({ type: "info", title: `Declined ${prompt.label}` });
    else
      toastManager.add({
        type: "error",
        title: "That code did not match",
        description: `${prompt.label} was not added. Run loom join on it again to start a new request.`,
      });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && sending === null) onLater();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Add {prompt.label} to your account?</DialogTitle>
          <DialogDescription>
            A computer named {prompt.label} is asking to join. Tap the code its terminal shows. If
            you did not run loom join, decline.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <div role="group" aria-label="Codes" className="grid gap-2">
              {prompt.choices.map((code) => (
                <Button
                  key={code}
                  size="lg"
                  variant="outline"
                  aria-label={`Approve with code ${code}`}
                  disabled={sending !== null}
                  onClick={() => void answer(code)}
                >
                  <span className="font-mono tracking-wider">
                    {sending !== code
                      ? code
                      : confirming
                        ? "Confirm with your passkey..."
                        : "Approving..."}
                  </span>
                </Button>
              ))}
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                Its key, also shown in the terminal:{" "}
                <span className="font-mono break-all">{prompt.keyFingerprint}</span>
              </p>
              <p>The request expires at {expires}. Picking a code it did not show declines it.</p>
              {passkey !== null ? <p>Approving asks for your passkey.</p> : null}
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="ghost-destructive"
            disabled={sending !== null}
            onClick={() => void answer(null)}
          >
            {sending === "decline" ? "Declining..." : "Decline"}
          </Button>
          {/* Focus starts here: the prompt can open mid-typing, and Enter on a code could approve. */}
          {confirming && passkey !== null ? (
            <DialogAction
              variant="outline"
              onClick={() => {
                cancelled.current = true;
                cancelJoinApproval(passkey);
              }}
            >
              Cancel
            </DialogAction>
          ) : (
            <DialogAction variant="outline" disabled={sending !== null} onClick={onLater}>
              Later
            </DialogAction>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
