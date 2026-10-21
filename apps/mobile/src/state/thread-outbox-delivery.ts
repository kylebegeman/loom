import type { MessageId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

export const threadOutboxDeliveryAtom = Atom.make<{
  readonly messageId: MessageId;
  readonly phase: "sending" | "confirming";
} | null>(null).pipe(Atom.keepAlive, Atom.withLabel("mobile:thread-outbox:delivery"));
