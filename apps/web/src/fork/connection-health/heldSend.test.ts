import { CommandId, EnvironmentId, MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { canHoldSendFor, unavailableSendNotice, useHeldSendStore } from "./heldSend";

const held = (messageId: string) => ({
  environmentId: EnvironmentId.make("dorothy"),
  messageId: MessageId.make(messageId),
  commandId: CommandId.make(`command-${messageId}`),
  dispatchMode: "auto" as const,
  draft: "[]",
});

describe("held follow-ups", () => {
  it("waits only for a computer that is coming back", () => {
    expect(canHoldSendFor("reconnecting")).toBe(true);
    expect(canHoldSendFor("offline")).toBe(true);
    expect(canHoldSendFor("error")).toBe(false);
    expect(canHoldSendFor("unsupported")).toBe(false);
    expect(canHoldSendFor("available")).toBe(false);
  });

  it("lets a late result release only the hold it belongs to", () => {
    const store = useHeldSendStore.getState();
    store.hold("thread-1", held("first"));
    store.hold("thread-1", held("second"));
    store.release("thread-1", MessageId.make("first"));
    expect(useHeldSendStore.getState().held["thread-1"]?.messageId).toBe("second");
    store.release("thread-1");
    expect(useHeldSendStore.getState().held["thread-1"]).toBeUndefined();
  });
});

describe("unavailable send notice", () => {
  const expired = {
    phase: "error",
    error: "Identity access expired.",
    blockedReason: "authentication",
  } as const;

  it("asks for a sign-in by name when the computer refused an expired one", () => {
    expect(
      unavailableSendNotice({ label: "Dorothy", connection: expired, identitySignIn: true }),
    ).toEqual({
      title: "Sign in to Dorothy to send",
      description: "Your message is still in the composer.",
    });
    expect(
      unavailableSendNotice({ label: "Dorothy", connection: expired, identitySignIn: false }).title,
    ).toBe("Not sent: Dorothy needs you to sign in or pair again");
  });

  it("names the computer and keeps the draft for every other state", () => {
    expect(
      unavailableSendNotice({
        label: "Dorothy",
        connection: { phase: "error", error: "Update your app.", blockedReason: "configuration" },
        identitySignIn: true,
      }),
    ).toEqual({
      title: "Not sent: can't connect to Dorothy",
      description: "Your message is still in the composer. Update your app.",
    });
    expect(
      unavailableSendNotice({
        label: "Dorothy",
        connection: { phase: "available", error: null },
        identitySignIn: false,
      }).title,
    ).toBe("Not sent: Dorothy is switched off");
  });
});
