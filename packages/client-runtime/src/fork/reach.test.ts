import { describe, expect, it } from "vite-plus/test";
import { EnvironmentAuthorizationError, EnvironmentId } from "@t3tools/contracts";
import {
  ReachBlocked,
  ReachError,
  ReachLibraryError,
  ReachLibraryRecordState,
  ReachState,
  ReachWarning,
  type ReachLibraryComputer,
  type ReachLibraryListing,
  type ReachLibrarySetup,
  type ReachStatus,
} from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { EnvironmentRpcUnavailableError } from "../rpc/client.ts";
import {
  REACH_BLOCKED_TEXT,
  REACH_CHANGE_ELSEWHERE_TEXT,
  REACH_UNREADABLE_TEXT,
  reachChangeErrorText,
  reachLibraryErrorText,
  reachLibraryView,
  reachPreparedEnvironment,
  reachView,
  type ReachViewInput,
} from "./reach.ts";

const ADDRESS = "https://studio-loom.example.com/";
const HOST = "studio-loom.example.com";
const TAILNET = "https://studio.example.ts.net/";
const LIBRARY = EnvironmentId.make("library");
const PREPARED = {
  issuer: "https://id.example.com",
  resource: "https://library.example.com/computers/studio",
  nativeClientId: "loom-native",
};

const status = (overrides: Partial<ReachStatus> = {}): ReachStatus => ({
  state: "connected",
  enabled: true,
  blocked: null,
  url: ADDRESS,
  message: null,
  warnings: [],
  prepared: null,
  ...overrides,
});

const input = (value: ReachStatus, overrides: Partial<ReachViewInput> = {}): ReachViewInput => ({
  result: AsyncResult.success(value),
  connected: true,
  supported: true,
  canRead: true,
  canChange: true,
  forgetSupported: true,
  isThisComputer: false,
  activeRouteUrl: TAILNET,
  ...overrides,
});

/** Every product line a view holds, so a test can check them all at once. */
const allText = (value: unknown) => JSON.stringify(value);

describe("reachView", () => {
  const cases = ReachState.literals.flatMap((state) =>
    [true, false].flatMap((connected) =>
      [true, false, null].flatMap((supported) =>
        [true, false].flatMap((canChange) =>
          [true, false].map((throughAddress) => ({
            state,
            connected,
            supported,
            canChange,
            throughAddress,
          })),
        ),
      ),
    ),
  );

  it.each(cases)(
    "$state, connected $connected, supported $supported, can change $canChange, via address $throughAddress",
    ({ state, connected, supported, canChange, throughAddress }) => {
      const enabled = state !== "off";
      const view = reachView(
        input(status({ state, enabled }), {
          connected,
          supported,
          canChange,
          activeRouteUrl: throughAddress ? `${ADDRESS}ws` : TAILNET,
        }),
      );
      const live = connected && supported === true;

      expect(allText(view)).not.toContain("—");
      expect(view.switch.checked).toBe(enabled);
      expect(view.switch.disabled).toBe(view.switch.disabledReason !== null);
      expect(view.switch.disabled).toBe(!live || !canChange || state === "removing");
      expect(view.confirmOff !== null).toBe(live && enabled && throughAddress);
      expect(view.actions.remove).toBe(live && canChange && state !== "removing");
      expect(view.actions.forget).toBe(live && canChange && state === "removing");
      expect(view.confirmForget !== null).toBe(view.actions.forget);
      expect(view.address).toEqual({ url: ADDRESS, host: HOST });
      if (supported === false)
        expect(view.status.text).toBe("Update Loom on this computer to turn this on.");
      else if (!connected) expect(view.status.text).toBe("Connect this computer to change reach.");
      else if (supported === null) expect(view.status.text).toBe("Checking reach...");
      if (live && !canChange) expect(view.switch.disabledReason).toBe(REACH_CHANGE_ELSEWHERE_TEXT);
    },
  );

  it("keeps the switch on while reach sets up, starts or retries", () => {
    for (const state of ["provisioning", "starting", "error"] as const) {
      const view = reachView(input(status({ state, message: "Your Library is busy." })));
      expect(view.switch).toEqual({ checked: true, disabled: false, disabledReason: null });
    }
  });

  it("describes each state with its address", () => {
    const line = (value: ReachStatus) => reachView(input(value)).status;
    expect(line(status())).toEqual({
      tone: "success",
      text: `On at ${HOST}. Every device still needs your sign-in or pairing.`,
    });
    expect(line(status({ state: "off", enabled: false }))).toMatchObject({
      text: `Off. ${HOST} is kept for when you turn it back on.`,
    });
    expect(line(status({ state: "off", enabled: false, url: null }))).toMatchObject({
      text: "Off. Devices connect on your network or tailnet only.",
    });
    expect(line(status({ state: "provisioning", url: null }))).toMatchObject({
      tone: "active",
      text: "Setting up an address for this computer...",
    });
    expect(line(status({ state: "starting" }))).toMatchObject({
      text: `Starting the tunnel to ${HOST}...`,
    });
    expect(line(status({ state: "removing" }))).toMatchObject({ text: `Removing ${HOST}...` });
  });

  it("shows the computer's own failure line under an error", () => {
    const view = reachView(
      input(
        status({
          state: "error",
          message: "Your Library could not be reached. Loom keeps trying.",
          warnings: ["library-unreachable"],
        }),
      ),
    );
    expect(view.status).toEqual({ tone: "danger", text: `${HOST} is not answering right now.` });
    expect(view.detail).toBe("Your Library could not be reached. Loom keeps trying.");
    // The detail already says the Library is unreachable.
    expect(view.notes).toEqual([]);
  });

  it("lets the computer's own line explain a Library sign-in failure while erroring or removing", () => {
    for (const state of ["error", "removing"] as const) {
      const view = reachView(
        input(
          status({
            state,
            enabled: state === "error",
            message: "Sign this computer in to its Library again, then restart Loom.",
            warnings: ["library-signed-out"],
          }),
        ),
      );
      expect(view.detail).toBe("Sign this computer in to its Library again, then restart Loom.");
      expect(view.notes).toEqual([]);
    }
    // With no line of its own, the warning still says it.
    const connected = reachView(input(status({ warnings: ["library-signed-out"] })));
    expect(connected.notes).toEqual([REACH_BLOCKED_TEXT["library-signed-out"]]);
  });

  it.each(ReachBlocked.literals)(
    "explains %s and keeps an enabled switch able to turn off",
    (blocked) => {
      const off = reachView(input(status({ state: "unavailable", enabled: false, blocked })));
      expect(off.status.text).toBe(REACH_BLOCKED_TEXT[blocked]);
      const on = reachView(input(status({ state: "unavailable", enabled: true, blocked })));
      expect(on.switch).toEqual({ checked: true, disabled: false, disabledReason: null });
      expect(allText([off, on])).not.toContain("—");
    },
  );

  it("disables the switch only for blocks that need the computer's Library connection fixed", () => {
    for (const blocked of ["no-library", "is-library", "library-signed-out"] as const) {
      const view = reachView(input(status({ state: "unavailable", enabled: false, blocked })));
      expect(view.switch).toEqual({
        checked: false,
        disabled: true,
        disabledReason: REACH_BLOCKED_TEXT[blocked],
      });
    }
    // A refused turn on leaves reach off; turning it on again asks the Library again.
    for (const blocked of ["library-not-ready", "library-outdated"] as const) {
      const view = reachView(input(status({ state: "unavailable", enabled: false, blocked })));
      expect(view.switch).toEqual({ checked: false, disabled: false, disabledReason: null });
      expect(view.status.text).toMatch(/turn this on again/iu);
      // A refusal at start keeps reach on, so the way back starts with turning it off.
      const on = reachView(input(status({ state: "unavailable", enabled: true, blocked })));
      expect(on.switch).toEqual({ checked: true, disabled: false, disabledReason: null });
      expect(on.status.text).toMatch(/turn reach off and on again/iu);
    }
  });

  it.each(ReachWarning.literals)("says something about %s", (warning) => {
    const view = reachView(input(status({ warnings: [warning] })));
    const said = [...view.notes, view.signIn?.text ?? ""].filter(Boolean);
    expect(said).toHaveLength(1);
    expect(allText(view)).not.toContain("—");
  });

  it("offers the prepared sign-in values only on the computer itself", () => {
    const value = status({ warnings: ["identity-off"], prepared: PREPARED });
    const elsewhere = reachView(input(value)).signIn;
    expect(elsewhere).toMatchObject({ values: null, copyText: null });
    expect(elsewhere?.text).toContain("only paired devices can connect");
    expect(elsewhere?.text).toContain(
      "Open its own Connections settings and choose Use these values.",
    );
    const here = reachView(input(value, { isThisComputer: true })).signIn;
    expect(here?.values).toEqual(PREPARED);
    expect(here?.copyText).toBe(reachPreparedEnvironment(PREPARED));
    expect(here?.copyText).toContain(`LOOM_IDENTITY_RESOURCE=${PREPARED.resource}`);
    expect(here?.copyText).toContain(`LOOM_IDENTITY_AUDIENCE=${PREPARED.resource}`);
  });

  it("points elsewhere for a sign-in that differs, and says nothing extra when it matches", () => {
    const differs = status({ warnings: ["identity-resource-differs"], prepared: PREPARED });
    expect(reachView(input(differs)).signIn).toEqual({
      text: "Your Library prepared Loom sign-in for this computer. Open its own Connections settings and choose Use these values.",
      values: null,
      copyText: null,
    });
    expect(reachView(input(differs, { isThisComputer: true })).signIn?.values).toEqual(PREPARED);
    expect(reachView(input(status({ prepared: PREPARED }))).signIn).toBeNull();
    expect(reachView(input(status({ warnings: ["identity-off"] }))).signIn).toEqual({
      text: "Loom sign-in is off on this computer, so only paired devices can connect.",
      values: null,
      copyText: null,
    });
  });

  it("asks before turning off or removing the address this device is connected through", () => {
    const through = reachView(input(status(), { activeRouteUrl: `${ADDRESS}ws?x=1` }));
    expect(through.throughAddress).toBe(true);
    expect(through.confirmOff).toEqual({
      title: "Turn reach off?",
      message: `You are connected through ${HOST}, so this device disconnects.`,
      action: "Turn off",
    });
    expect(through.confirmRemove).toMatchObject({ title: `Remove ${HOST}?`, action: "Remove" });
    expect(through.confirmRemove?.message).toContain("this device disconnects");
    const elsewhere = reachView(input(status()));
    expect(elsewhere.throughAddress).toBe(false);
    expect(elsewhere.confirmOff).toBeNull();
    expect(elsewhere.confirmRemove?.title).toBe(`Remove ${HOST}?`);
    expect(elsewhere.confirmRemove?.message).not.toContain("this device disconnects");
    // Same host over plain HTTP is another origin, and an unknown route never matches.
    expect(reachView(input(status(), { activeRouteUrl: `http://${HOST}` })).throughAddress).toBe(
      false,
    );
    expect(reachView(input(status(), { activeRouteUrl: null })).confirmOff).toBeNull();
    expect(reachView(input(status(), { activeRouteUrl: "not a url" })).throughAddress).toBe(false);
    // Every question is one sentence ending in a question mark, which the dialogs title.
    for (const confirm of [through.confirmOff, through.confirmRemove, elsewhere.confirmRemove]) {
      expect(confirm?.title).toMatch(/^[^?]+\?$/u);
      expect(confirm?.message).not.toContain("?");
    }
  });

  it("offers to forget a removal the Library may never confirm, asking first", () => {
    const stuck = status({
      state: "removing",
      enabled: false,
      message: "Update Loom on your Library to finish removing reach.",
    });
    const view = reachView(input(stuck));
    expect(view.actions).toMatchObject({ forget: true, remove: false });
    expect(view.confirmForget).toEqual({
      title: "Forget reach on this computer?",
      message:
        "Reach stops here without your Library. Its tunnel and address stay until you retire them in your Library under Reach addresses.",
      action: "Forget",
    });
    expect(view.confirmForget?.title).toMatch(/^[^?]+\?$/u);
    expect(view.confirmForget?.message).not.toContain("?");
    expect(allText(view)).not.toContain("—");
    // A computer that predates forget would refuse the call, so it is never offered there.
    expect(reachView(input(stuck, { forgetSupported: false }))).toMatchObject({
      actions: { forget: false },
      confirmForget: null,
    });
    expect(reachView(input(stuck, { canChange: false })).actions.forget).toBe(false);
    for (const state of ["off", "connected", "error"] as const) {
      expect(reachView(input(status({ state }))).confirmForget).toBeNull();
    }
  });

  it("says plainly that the Library retired the address, once", () => {
    const retired = status({
      state: "off",
      enabled: false,
      url: null,
      // What the computer sends for clients that predate the warning.
      message:
        "Your Library retired this computer's address, or another copy of this computer took it over. Turn reach on to get an address again.",
      warnings: ["retired"],
    });
    const view = reachView(input(retired));
    expect(view.status).toEqual({
      tone: "warning",
      text: "Your Library retired this computer's address, or another copy of this computer took it over. Turn reach on to get an address again.",
    });
    expect(view.detail).toBeNull();
    expect(view.notes).toEqual([]);
    // Turning reach on is the way back, so the switch stays usable.
    expect(view.switch).toEqual({ checked: false, disabled: false, disabledReason: null });
    expect(view.actions).toMatchObject({ remove: false, forget: false, copyAddress: false });
    // A computer's own wording never doubles the line, even when it differs.
    expect(reachView(input({ ...retired, message: "Retired." })).detail).toBeNull();
  });

  it("offers a retry when the status cannot be read", () => {
    const view = reachView({
      ...input(status()),
      result: AsyncResult.failure(Cause.fail(new ReachError({ reason: "storage" }))),
    });
    expect(view.status).toEqual({
      tone: "danger",
      text: "Loom could not read reach on this computer.",
    });
    expect(view.actions).toEqual({
      copyAddress: false,
      remove: false,
      forget: false,
      retry: true,
    });
    expect(view.switch.disabled).toBe(true);
  });

  it("keeps the last status under a note, with a retry, when the stream fails later", () => {
    const failure = AsyncResult.failure(Cause.fail(new ReachError({ reason: "storage" })), {
      previousSuccess: Option.some(AsyncResult.success(status())),
    });
    const view = reachView({ ...input(status()), result: failure });
    expect(view.status.text).toBe(
      `On at ${HOST}. Every device still needs your sign-in or pairing.`,
    );
    expect(view.notes).toEqual([
      "Loom could not refresh reach on this computer, so this is the last state it read.",
    ]);
    expect(view.actions.retry).toBe(true);
    expect(view.switch.disabled).toBe(false);
  });

  it("asks for a full-access pairing, with no retry, when the session cannot read reach", () => {
    const view = reachView({ ...input(status()), result: AsyncResult.initial(), canRead: false });
    expect(view.status).toEqual({ tone: "neutral", text: REACH_UNREADABLE_TEXT });
    expect(view.switch).toEqual({
      checked: false,
      disabled: true,
      disabledReason: REACH_UNREADABLE_TEXT,
    });
    expect(view.actions).toEqual({
      copyAddress: false,
      remove: false,
      forget: false,
      retry: false,
    });
    const unknown = reachView({ ...input(status()), result: AsyncResult.initial(), canRead: null });
    expect(unknown.status.text).toBe("Checking reach...");
  });

  it("reads as loading before the first status", () => {
    const view = reachView({ ...input(status()), result: AsyncResult.initial() });
    expect(view.status.text).toBe("Checking reach...");
    expect(view.switch).toMatchObject({ checked: false, disabled: true });
  });
});

const dropped = new EnvironmentRpcUnavailableError({ environmentId: "studio", message: "closed" });

describe("reachChangeErrorText", () => {
  it("never says a device cannot change reach", () => {
    const denied = new EnvironmentAuthorizationError({
      message: "This connection requires relay:write.",
      requiredScope: "relay:write",
      requiredPermission: "relay:write",
    });
    expect(reachChangeErrorText(Cause.fail(denied))).toBe(REACH_CHANGE_ELSEWHERE_TEXT);
    expect(REACH_CHANGE_ELSEWHERE_TEXT).not.toMatch(/cannot|can't|not allowed/u);
  });

  it("uses a reach refusal's own line and a generic one for anything else", () => {
    expect(reachChangeErrorText(Cause.fail(new ReachError({ reason: "busy" })))).toBe(
      new ReachError({ reason: "busy" }).message,
    );
    expect(reachChangeErrorText(Cause.fail(dropped))).toBe(
      "Connect this computer to change reach.",
    );
    expect(reachChangeErrorText(Cause.die(new Error("socket body with a secret")))).toBe(
      "Loom could not change reach on this computer.",
    );
  });

  it("treats a reply lost with a confirmed route drop as the expected outcome", () => {
    expect(reachChangeErrorText(Cause.fail(dropped), true)).toBeNull();
    expect(reachChangeErrorText(Cause.die(new Error("socket closed")), true)).toBeNull();
    // A refusal the computer sent before the route dropped still counts.
    expect(reachChangeErrorText(Cause.fail(new ReachError({ reason: "busy" })), true)).toBe(
      new ReachError({ reason: "busy" }).message,
    );
  });

  it("stays quiet when the change was interrupted", () => {
    expect(reachChangeErrorText(Cause.interrupt())).toBeNull();
  });
});

const computer = (overrides: Partial<ReachLibraryComputer> = {}): ReachLibraryComputer => ({
  environmentId: EnvironmentId.make("studio"),
  label: "Studio",
  hostname: HOST,
  state: "ready",
  lastError: null,
  connection: "connected",
  connectors: 1,
  leftoverDnsRecordId: null,
  identity: null,
  signIn: "ended",
  updatedAt: "2026-10-20T12:00:00.000Z",
  lastEnsuredAt: "2026-10-20T12:00:00.000Z",
  ...overrides,
});

const listingOf = (computers: readonly ReachLibraryComputer[]): ReachLibraryListing => ({
  setup: {
    zone: "example.com",
    cloudflare: "ready",
    identity: "missing",
    edge: { allowlist: "ready", rateLimit: "occupied", checkedAt: "2026-10-20T12:00:00.000Z" },
  },
  computers,
});

describe("reachLibraryView", () => {
  const library = (
    result: AsyncResult.AsyncResult<ReachLibraryListing, unknown>,
    overrides: Partial<Parameters<typeof reachLibraryView>[0]> = {},
  ) =>
    reachLibraryView({
      result,
      libraryId: LIBRARY,
      supported: true,
      canRetire: true,
      ...overrides,
    });

  it("explains every state before a list arrives", () => {
    expect(library(AsyncResult.initial(), { libraryId: null }).status).toBe("no-library");
    expect(library(AsyncResult.initial(), { supported: false }).status).toBe("unsupported");
    expect(library(AsyncResult.initial())).toMatchObject({
      status: "loading",
      notice: "Loading reach addresses...",
    });
    const failed = library(
      AsyncResult.failure(Cause.fail(new ReachLibraryError({ reason: "not-configured" }))),
    );
    expect(failed).toMatchObject({ status: "failed", notice: null, retry: true });
    expect(failed.error).toBe(new ReachLibraryError({ reason: "not-configured" }).message);
    expect(library(AsyncResult.success(listingOf([])))).toMatchObject({
      status: "empty",
      notice: "No computer has reach yet. Turn it on in a computer's Connections settings.",
    });
  });

  it("keeps the last list under an error line with a retry when a refresh fails", () => {
    const view = library(
      AsyncResult.failure(Cause.fail(new ReachLibraryError({ reason: "not-configured" })), {
        previousSuccess: Option.some(AsyncResult.success(listingOf([computer()]))),
      }),
    );
    expect(view).toMatchObject({ status: "listed", notice: null, retry: true });
    expect(view.error).toBe(new ReachLibraryError({ reason: "not-configured" }).message);
    expect(view.computers.map((row) => row.title)).toEqual(["Studio"]);
    const fresh = library(AsyncResult.success(listingOf([computer()])));
    expect(fresh).toMatchObject({ error: null, retry: false });
  });

  it("flags extra connectors, leftovers, Identity failures and a live Library sign-in", () => {
    const view = library(
      AsyncResult.success(
        listingOf([
          computer({
            connectors: 2,
            state: "removed-with-leftover",
            leftoverDnsRecordId: "dns-1",
            lastError: "key-changed",
            identity: { resource: "https://r.example.com", state: "failed", lastError: "denied" },
            signIn: "active",
          }),
        ]),
      ),
    );
    const [row] = view.computers;
    expect(row?.notes).toHaveLength(5);
    expect(row?.notes[0]).toContain("2 connectors are attached");
    expect(row?.notes[1]).toContain("dns-1");
    expect(row?.notes[4]).toBe("The address stays reserved for this computer.");
    expect(row?.retire?.confirm).toMatchObject({ title: `Retire ${HOST}?`, action: "Retire" });
    expect(row?.retire?.confirm.message).toContain("revoke its Library sign-in too");
    expect(row?.retire?.endIdentityLabel).toBe("Also end Loom sign-in for this computer");
    expect(view.setup.map((line) => line.text)).toContain(
      "Another rate-limit rule holds the zone's only slot, so reach addresses have no rate limit.",
    );
    expect(allText(view)).not.toContain("—");
  });

  it("says a failed end of Loom sign-in may have left it working, not that it was never prepared", () => {
    const failed = {
      resource: "https://r.example.com",
      state: "failed",
      lastError: "unavailable",
    } as const;
    const notesFor = (state: ReachLibraryComputer["state"]) =>
      library(AsyncResult.success(listingOf([computer({ state, identity: failed })]))).computers[0]
        ?.notes ?? [];
    for (const state of ["removed", "removed-with-leftover"] as const) {
      const [identityNote] = notesFor(state);
      expect(identityNote).toContain("may still work");
      expect(identityNote).toContain("Retire it and end Loom sign-in to try again.");
    }
    expect(notesFor("ready")).toEqual([
      "Pocket ID did not answer, so Loom sign-in was not prepared.",
    ]);
  });

  it("offers ending Loom sign-in only while the Library's admin key file is in place", () => {
    const retireWith = (identity: ReachLibrarySetup["identity"]) =>
      library(
        AsyncResult.success({
          ...listingOf([computer()]),
          setup: { ...listingOf([]).setup, identity },
        }),
      ).computers[0]?.retire;
    const keyless = retireWith("missing");
    expect(keyless?.endIdentityDisabledReason).toContain("Pocket ID key file");
    expect(keyless?.endIdentityDisabledReason).not.toContain("—");
    // A key Pocket ID refused or that did not answer last time may work now, so it stays offered.
    for (const identity of ["ready", "refused", "unavailable"] as const) {
      expect(retireWith(identity)?.endIdentityDisabledReason).toBeNull();
    }
  });

  it("points a device without settings access elsewhere to retire", () => {
    const view = library(AsyncResult.success(listingOf([computer()])), { canRetire: false });
    expect(view.computers[0]?.retire).toBeNull();
    expect(view.retireDisabledReason).toBe(
      "Retire reach addresses from your Library itself or from a device paired with full access.",
    );
    const denied = new EnvironmentAuthorizationError({
      message: "This connection requires settings:write.",
      requiredScope: "settings:write",
    });
    expect(reachLibraryErrorText(Cause.fail(denied), "retire")).toBe(view.retireDisabledReason);
  });

  it("keeps each computer's state a short label and its sentences in notes", () => {
    const view = library(
      AsyncResult.success(
        listingOf(
          ReachLibraryRecordState.literals.map((state, index) =>
            computer({
              environmentId: EnvironmentId.make(`computer-${index}`),
              label: `C${index}`,
              state,
            }),
          ),
        ),
      ),
    );
    for (const row of view.computers) expect(row.state.text).not.toContain(".");
    const removed = view.computers.find((row) => row.state.text === "Removed");
    expect(removed?.notes).toEqual(["The address stays reserved for this computer."]);
  });

  it("says when the chosen Library is no longer saved on this device", () => {
    const unregistered = Cause.fail({ _tag: "EnvironmentNotRegisteredError" });
    expect(reachLibraryErrorText(unregistered, "list")).toBe(
      "Your Library is not saved on this device.",
    );
    expect(reachLibraryErrorText(Cause.fail(dropped), "retire")).toBe(
      "Your Library is not reachable right now.",
    );
  });
});
