import type { ComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import { CommandId, type EnvironmentId, type MessageId } from "@t3tools/contracts";
import type {
  EnvironmentConnectionPhase,
  EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import { create } from "zustand";
import type { ComposerThreadDraftState } from "~/composerDraftStore";
import { newMessageId, randomUUID } from "~/lib/utils";

/**
 * One follow-up held while its computer reconnects. The draft stays in the composer and sends
 * once, with these ids, when the computer is back. Keeping the ids makes a resend after an
 * uncertain delivery safe: the server answers a command it already accepted from its receipt.
 */
export interface HeldSend {
  readonly environmentId: EnvironmentId;
  readonly messageId: MessageId;
  readonly commandId: CommandId;
  readonly dispatchMode: ComposerDispatchMode;
  /** The draft as it was held. Editing it releases the hold, so half-typed text never sends. */
  readonly draft: string;
  /**
   * Held after a send failed on a dropped connection. It waits to see the computer go and come
   * back, so a connection that still looks up does not resend in a loop.
   */
  readonly afterFailure?: true;
}

interface HeldSendStore {
  /** By scoped thread key. Kept in memory only, like the page's other in-flight sends. */
  readonly held: Readonly<Record<string, HeldSend>>;
  readonly hold: (threadKey: string, send: HeldSend) => void;
  /** With `messageId`, releases only that hold, so a newer one survives a late result. */
  readonly release: (threadKey: string, messageId?: MessageId) => void;
}

export const useHeldSendStore = create<HeldSendStore>((set) => ({
  held: {},
  hold: (threadKey, send) => set((state) => ({ held: { ...state.held, [threadKey]: send } })),
  release: (threadKey, messageId) =>
    set((state) => {
      const current = state.held[threadKey];
      if (current === undefined || (messageId !== undefined && current.messageId !== messageId)) {
        return state;
      }
      const { [threadKey]: _released, ...held } = state.held;
      return { held };
    }),
}));

export const newCommandId = () => CommandId.make(randomUUID());

export const newHeldSendIds = () => ({ messageId: newMessageId(), commandId: newCommandId() });

/**
 * What a hold compares to notice an edit: the text and which attachments and contexts are in it.
 * Background work such as saving an image does not change it.
 */
export function heldDraftSignature(draft: ComposerThreadDraftState | null | undefined): string {
  if (!draft) return "";
  return JSON.stringify([
    draft.prompt,
    draft.images.map((image) => image.id),
    draft.files.map((file) => file.id),
    draft.terminalContexts.length,
    draft.previewAnnotations.length,
    draft.reviewComments.length,
    draft.threadContexts.length,
  ]);
}

/**
 * A computer that is only reconnecting or offline is expected back, so a send can wait for it.
 * One that refused this device, or that this version of Loom cannot use, is not.
 */
export const canHoldSendFor = (phase: EnvironmentConnectionPhase) =>
  phase === "connecting" || phase === "reconnecting" || phase === "offline";

const KEPT = "Your message is still in the composer.";

/** The toast for a send that cannot wait for its computer. It names the computer and the fix. */
export function unavailableSendNotice(input: {
  readonly label: string;
  readonly connection: Pick<EnvironmentConnectionPresentation, "phase" | "error" | "blockedReason">;
  /** This device can sign in to the computer again from the chat. */
  readonly identitySignIn: boolean;
}): { readonly title: string; readonly description: string } {
  const { label, connection } = input;
  if (connection.phase === "error" && connection.blockedReason === "authentication") {
    return input.identitySignIn
      ? { title: `Sign in to ${label} to send`, description: KEPT }
      : {
          title: `Not sent: ${label} needs you to sign in or pair again`,
          description: `${KEPT} Open Connections to fix it.`,
        };
  }
  switch (connection.phase) {
    case "connecting":
    case "reconnecting":
      return {
        title: `Not sent: ${label} is reconnecting`,
        description: `${KEPT} Send it again once ${label} is back.`,
      };
    case "offline":
      return {
        title: "Not sent: this device is offline",
        description: `${KEPT} Send it again once you're back online.`,
      };
    case "available":
      return {
        title: `Not sent: ${label} is switched off`,
        description: `${KEPT} Switch it on in Connections to send.`,
      };
    default:
      return {
        title: `Not sent: can't connect to ${label}`,
        description: connection.error === null ? KEPT : `${KEPT} ${connection.error}`,
      };
  }
}
