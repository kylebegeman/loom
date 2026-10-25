import {
  AuthSettingsWriteScope,
  EnvironmentAuthorizationError,
  EnvironmentId,
  authScopeRequiredResponse,
} from "@t3tools/contracts";
import {
  LibraryPushError,
  type LibraryPushDevice,
  type LibraryPushStatus,
} from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import {
  libraryPushErrorText,
  libraryPushRemoveText,
  libraryPushTestText,
  libraryPushView,
  type LibraryPushViewInput,
} from "./libraryPushView";

const LIBRARY = EnvironmentId.make("library");
const OFF_TEXT = "Push notifications are off on this Library.";
const NO_APP_TEXT = "The Library's push settings name no app it can send to.";

function device(overrides: Partial<LibraryPushDevice> = {}): LibraryPushDevice {
  return {
    id: "AAAAAAAAAAAAAAAAAAAAAA",
    deviceId: "phone-1",
    label: "Kyle's iPhone",
    bundleId: "com.kylebegeman.loom",
    apsEnvironment: "production",
    appVersion: "0.0.91",
    registeredAt: "2026-10-01T09:00:00.000Z",
    refreshedAt: "2026-10-20T09:00:00.000Z",
    expiresAt: "2026-11-19T09:00:00.000Z",
    mine: true,
    lastDelivery: null,
    ...overrides,
  };
}

function status(overrides: Partial<LibraryPushStatus> = {}): LibraryPushStatus {
  return {
    state: "ready",
    reason: null,
    key: { teamId: "23W93ZUURR", keyId: "ABCDE12345" },
    devices: [],
    ...overrides,
  };
}

function view(
  result: LibraryPushViewInput["result"],
  overrides: Partial<Omit<LibraryPushViewInput, "result">> = {},
) {
  return libraryPushView({
    libraryId: LIBRARY,
    connected: true,
    supported: true,
    alerts: false,
    result,
    canTest: true,
    canRemove: true,
    formatDate: (iso) => iso.slice(0, 10),
    ...overrides,
  });
}

const denied = new EnvironmentAuthorizationError({
  ...authScopeRequiredResponse(AuthSettingsWriteScope),
  message: "This connection requires settings:write.",
});

describe("libraryPushView", () => {
  it("hides the section until a Library is chosen", () => {
    expect(view(AsyncResult.initial(), { libraryId: null })).toMatchObject({
      status: "no-library",
      headline: null,
      refreshable: false,
    });
  });

  it("asks for a connection before reading anything", () => {
    expect(view(AsyncResult.initial(), { connected: false })).toMatchObject({
      status: "disconnected",
      headline: { text: "Connect to your Library to see its push notifications." },
      refreshable: false,
    });
  });

  it("calls push off when the Library does not advertise it, without reading", () => {
    expect(view(AsyncResult.initial(), { supported: false })).toMatchObject({
      status: "off",
      headline: { tone: "neutral", text: OFF_TEXT },
      refreshable: false,
      devices: [],
    });
  });

  it("shows a loading line while capabilities or the first read are pending", () => {
    expect(view(AsyncResult.initial(), { supported: null })).toMatchObject({
      status: "loading",
      headline: { text: "Checking push notifications..." },
      refreshable: false,
    });
    expect(view(AsyncResult.initial(true))).toMatchObject({
      status: "loading",
      refreshable: true,
    });
  });

  it("names each misconfigured key reason and offers no test", () => {
    const unreadable = view(
      AsyncResult.success(
        status({
          state: "misconfigured",
          reason: "key-unreadable",
          key: null,
          devices: [device()],
        }),
      ),
    );
    expect(unreadable).toMatchObject({
      status: "misconfigured",
      headline: { tone: "danger", text: "The Library can't read its Apple push key." },
      key: null,
    });
    expect(unreadable.hint).toContain("restart the Library");
    expect(unreadable.devices[0]?.test).toBe(false);

    const invalid = view(
      AsyncResult.success(status({ state: "misconfigured", reason: "key-invalid" })),
    );
    expect(invalid.headline).toEqual({
      tone: "danger",
      text: "The Library's Apple push key is not a valid key.",
    });
  });

  it("reports ready with no phones yet", () => {
    expect(view(AsyncResult.success(status()))).toMatchObject({
      status: "ready",
      headline: { tone: "success" },
      key: "Apple key ABCDE12345, team 23W93ZUURR.",
      devices: [],
      empty: "No iPhones are registered yet.",
      error: null,
      retry: false,
    });
  });

  it("keeps today's ready line for a Library from before the served list", () => {
    expect(view(AsyncResult.success(status()))).toMatchObject({
      status: "ready",
      headline: {
        tone: "success",
        text: "On. iPhones signed in to this Library can turn on notifications in Loom's settings.",
      },
      builds: null,
    });
  });

  it("lists the builds the Library sends to, naming ones this client does not know by ID", () => {
    const result = view(
      AsyncResult.success(
        status({
          topics: [
            { bundleId: "com.kylebegeman.loom", apsEnvironment: "production" },
            { bundleId: "com.kylebegeman.loom.dev", apsEnvironment: "sandbox" },
            { bundleId: "com.kylebegeman.loom.next", apsEnvironment: "production" },
          ],
        }),
      ),
    );
    expect(result).toMatchObject({ status: "ready", headline: { tone: "success" } });
    expect(result.builds).toBe(
      "Builds it sends to: Loom (Production), Loom Dev (Development), com.kylebegeman.loom.next (Production).",
    );
  });

  it("says push cannot reach any app instead of On when the served list is empty", () => {
    const result = view(AsyncResult.success(status({ topics: [] })));
    expect(result).toMatchObject({
      status: "no-app",
      headline: { tone: "danger", text: NO_APP_TEXT },
      key: "Apple key ABCDE12345, team 23W93ZUURR.",
      builds: null,
      empty: null,
    });
    expect(result.hint).toContain("restart the Library");
  });

  it("keeps a key problem in the headline and names the empty list below it", () => {
    expect(
      view(
        AsyncResult.success(status({ state: "misconfigured", reason: "key-invalid", topics: [] })),
      ),
    ).toMatchObject({
      status: "misconfigured",
      headline: { text: "The Library's Apple push key is not a valid key." },
      builds: NO_APP_TEXT,
    });
  });

  it("lists several phones with their app, environment, dates and last notification", () => {
    const result = view(
      AsyncResult.success(
        status({
          devices: [
            device({
              lastDelivery: { at: "2026-10-22T08:00:00.000Z", outcome: "sent", reason: null },
            }),
            device({
              id: "BBBBBBBBBBBBBBBBBBBBBB",
              label: "Test iPad",
              bundleId: "com.kylebegeman.loom.dev",
              apsEnvironment: "sandbox",
              appVersion: null,
              mine: false,
            }),
          ],
        }),
      ),
    );
    expect(result.empty).toBeNull();
    expect(result.devices).toEqual([
      {
        id: "AAAAAAAAAAAAAAAAAAAAAA",
        label: "Kyle's iPhone",
        detail: "Loom 0.0.91 · Production · Registered 2026-10-01 · Expires 2026-11-19",
        lastDelivery: { tone: "success", text: "Last notification sent 2026-10-22." },
        test: true,
        remove: { confirm: expect.stringContaining("Remove Kyle's iPhone?") },
      },
      {
        id: "BBBBBBBBBBBBBBBBBBBBBB",
        label: "Test iPad",
        detail: "Loom Dev · Development · Registered 2026-10-01 · Expires 2026-11-19",
        lastDelivery: null,
        test: true,
        remove: { confirm: expect.stringContaining("Remove Test iPad?") },
      },
    ]);
  });

  it("keeps tests available while Apple refuses the key, since a test that gets through clears it", () => {
    const result = view(
      AsyncResult.success(
        status({
          state: "failing",
          reason: "key-rejected",
          devices: [
            device({
              lastDelivery: {
                at: "2026-10-23T08:00:00.000Z",
                outcome: "failed",
                reason: "key-rejected",
              },
            }),
          ],
        }),
      ),
    );
    expect(result).toMatchObject({
      status: "failing",
      headline: { tone: "danger", text: "Apple refused the Library's push key." },
    });
    expect(result.devices[0]).toMatchObject({
      test: true,
      lastDelivery: {
        tone: "danger",
        text: "Last notification failed 2026-10-23. Apple refused the Library's push key.",
      },
    });
  });

  it("explains a topic Apple will not accept on that phone's row", () => {
    const result = view(
      AsyncResult.success(
        status({
          devices: [
            device({
              lastDelivery: {
                at: "2026-10-23T08:00:00.000Z",
                outcome: "failed",
                reason: "topic-disallowed",
              },
            }),
          ],
        }),
      ),
    );
    expect(result.status).toBe("ready");
    expect(result.devices[0]?.lastDelivery).toEqual({
      tone: "danger",
      text: "Last notification failed 2026-10-23. Apple won't accept the Library's push key for this build of Loom.",
    });
  });

  it("says whether the Library sends agent alerts wherever it can send at all", () => {
    const ready = AsyncResult.success(status());
    expect(view(ready, { alerts: true }).alerts).toBe(
      "Agent alerts are on: the Library notifies your iPhones when an agent on any of your computers needs your approval or an answer, fails, reaches a usage limit or finishes.",
    );
    expect(view(ready).alerts).toBe(
      "Agent alerts are off, so the Library sends only test notifications. They are turned on in the Library's server environment.",
    );
    expect(
      view(AsyncResult.success(status({ state: "failing", reason: "key-rejected" })), {
        alerts: true,
      }).alerts,
    ).toContain("Agent alerts are on");
    for (const silent of [
      status({ state: "misconfigured", reason: "key-invalid" }),
      status({ state: "off", reason: null, key: null }),
      status({ topics: [] }),
    ]) {
      expect(view(AsyncResult.success(silent), { alerts: true }).alerts).toBeNull();
    }
    expect(view(ready, { alerts: true, supported: false }).alerts).toBeNull();
  });

  it("offers Remove only with the unregister permission, and Send test only with the test permission", () => {
    const listed = AsyncResult.success(status({ devices: [device()] }));
    expect(view(listed, { canRemove: false }).devices[0]).toMatchObject({
      remove: null,
      test: true,
    });
    expect(view(listed, { canTest: false }).devices[0]).toMatchObject({ test: false });
    expect(view(listed, { canTest: false }).devices[0]?.remove).not.toBeNull();
  });

  it("says why a connection without Settings permission sees no phones", () => {
    expect(view(AsyncResult.success(status()), { canRemove: false, canTest: false }).empty).toBe(
      "This connection can't list the Library's iPhones. Use a device signed in with your Loom account or paired with Settings permission.",
    );
  });

  it("treats a Library that reports push off like a missing slug", () => {
    expect(
      view(AsyncResult.success(status({ state: "off", reason: null, key: null }))),
    ).toMatchObject({
      status: "off",
      headline: { text: OFF_TEXT },
      empty: null,
      refreshable: true,
    });
  });

  it("turns a failed first read into a retry and keeps an earlier answer on a failed refresh", () => {
    const failed = view(
      AsyncResult.failure(
        Cause.fail({ _tag: "EnvironmentRpcUnavailableError", message: "closed" }),
      ),
    );
    expect(failed).toMatchObject({
      status: "failed",
      headline: { tone: "danger", text: "Your Library is not reachable right now." },
      retry: true,
    });

    const stale = view(
      AsyncResult.failure(Cause.fail(new LibraryPushError({ reason: "storage" })), {
        previousSuccess: Option.some(AsyncResult.success(status({ devices: [device()] }))),
      }),
    );
    expect(stale).toMatchObject({
      status: "ready",
      error: new LibraryPushError({ reason: "storage" }).message,
      retry: true,
    });
    expect(stale.devices).toHaveLength(1);
  });
});

describe("libraryPushErrorText", () => {
  it("uses the push error's fixed message", () => {
    expect(
      libraryPushErrorText(Cause.fail(new LibraryPushError({ reason: "rate-limited" })), "test"),
    ).toBe(new LibraryPushError({ reason: "rate-limited" }).message);
  });

  it("names the missing permission without repeating the scope", () => {
    expect(libraryPushErrorText(Cause.fail(denied), "status")).toBe(
      "This connection can't read push notifications on your Library.",
    );
    expect(libraryPushErrorText(Cause.fail(denied), "remove")).toContain(
      "can't change push notifications",
    );
  });

  it("falls back to a line per action for anything else", () => {
    const boom = Cause.die(new Error("boom"));
    expect(libraryPushErrorText(boom, "status")).toBe(
      "Loom could not read push notifications on your Library.",
    );
    expect(libraryPushErrorText(boom, "test")).toBe("Couldn't send a test notification.");
    expect(libraryPushErrorText(boom, "remove")).toBe("Couldn't remove this iPhone.");
  });
});

describe("libraryPushTestText", () => {
  const delivery = {
    id: "AAAAAAAAAAAAAAAAAAAAAA",
    label: "Kyle's iPhone",
  } as const;

  it("describes each outcome of a test", () => {
    expect(
      libraryPushTestText(
        { deliveries: [{ ...delivery, outcome: "sent", reason: null }] },
        "Kyle's iPhone",
      ),
    ).toEqual({
      tone: "success",
      text: "Test sent to Kyle's iPhone. It should arrive in a few seconds.",
    });
    expect(
      libraryPushTestText(
        { deliveries: [{ ...delivery, outcome: "failed", reason: "unavailable" }] },
        "Kyle's iPhone",
      ),
    ).toEqual({
      tone: "warning",
      text: "Couldn't send a test to Kyle's iPhone. Apple did not answer. Try again later.",
    });
    expect(
      libraryPushTestText(
        { deliveries: [{ ...delivery, outcome: "removed", reason: "bad-token" }] },
        "Kyle's iPhone",
      ).text,
    ).toContain("so the Library removed it");
  });

  it("says the phone is gone when the test targeted nothing", () => {
    expect(libraryPushTestText({ deliveries: [] }, "Kyle's iPhone")).toEqual({
      tone: "neutral",
      text: "Kyle's iPhone is no longer registered with this Library.",
    });
  });
});

describe("libraryPushRemoveText", () => {
  it("separates a removal from a phone that was already gone", () => {
    expect(libraryPushRemoveText({ removed: true }, "Kyle's iPhone").tone).toBe("success");
    expect(libraryPushRemoveText({ removed: false }, "Kyle's iPhone")).toEqual({
      tone: "neutral",
      text: "Kyle's iPhone was already removed.",
    });
  });
});
