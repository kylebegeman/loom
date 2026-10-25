import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  BearerConnectionTarget,
} from "@t3tools/client-runtime/connection";
import {
  directoryComputersView,
  storedDirectoryListing,
  type DirectoryConnectStep,
  type StoredDirectoryListing,
} from "@t3tools/client-runtime/fork";
import { EnvironmentId } from "@t3tools/contracts";
import type { DirectoryEnvironment, LoomIdentityAccount } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import type { NativeIdentitySignIn } from "../library/nativeIdentitySignIn";
import {
  connectDirectoryComputer,
  directoryPairing,
  directoryPairingAddress,
  directorySectionContent,
  pairingFormChecks,
  type DirectoryConnectDependencies,
} from "./directoryComputers";

const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const MINUTE = 60_000;
const iso = (at: number) => new Date(at).toISOString();
const LIBRARY = EnvironmentId.make("library");
const STUDIO = EnvironmentId.make("studio");
const BOOK = EnvironmentId.make("book");
const ISSUER = "https://id.example.com";
const ACCOUNT: LoomIdentityAccount = { issuer: ISSUER, subject: "kyle" };

function reported(
  environmentId: EnvironmentId,
  overrides: Partial<DirectoryEnvironment> = {},
): DirectoryEnvironment {
  return {
    environmentId,
    label: environmentId,
    serverVersion: "1.0.0",
    platform: { os: "darwin", arch: "arm64" },
    supportsExecution: true,
    loomFeatures: [],
    routes: [{ kind: "tailnet", url: `https://${environmentId}.example.ts.net` }],
    providers: [],
    sequence: 1,
    reportedAt: iso(NOW - 2 * MINUTE),
    keyFingerprint: "a".repeat(64),
    firstSeenAt: iso(NOW - 60 * MINUTE),
    receivedAt: iso(NOW - 2 * MINUTE),
    ...overrides,
  };
}

const kept = (environments: DirectoryEnvironment[], fetchedAt = NOW - 180 * MINUTE) =>
  storedDirectoryListing(LIBRARY, { environments, machines: [], generatedAt: iso(NOW) }, fetchedAt);

const offline = AsyncResult.failure<StoredDirectoryListing, unknown>(
  Cause.fail({ _tag: "EnvironmentRpcUnavailableError", message: "offline" }),
);

function content(input: {
  readonly live?: AsyncResult.AsyncResult<StoredDirectoryListing, unknown>;
  readonly stored?: StoredDirectoryListing | null;
  readonly library?: EnvironmentId | null;
  readonly supportsDirectory?: boolean | null;
  readonly savedReady?: boolean;
  readonly libraryRetrying?: boolean;
}) {
  return directorySectionContent(
    directoryComputersView({
      authorityEnvironmentId: input.library === undefined ? LIBRARY : input.library,
      supportsDirectory: input.supportsDirectory === undefined ? true : input.supportsDirectory,
      libraryConnection: input.libraryRetrying
        ? { phase: "reconnecting", error: "Connection refused" }
        : { phase: "connecting", error: null },
      live: input.live ?? AsyncResult.initial(true),
      stored: input.stored ?? null,
      saved: [
        { environmentId: LIBRARY, label: "Library" },
        { environmentId: STUDIO, label: "Studio" },
      ],
      now: NOW,
    }),
    input.savedReady ?? true,
  );
}

describe("Library computers section", () => {
  const everyone = kept([
    reported(LIBRARY),
    reported(STUDIO),
    reported(BOOK, { label: "Book", platform: { os: "linux", arch: "x64" } }),
  ]);

  it("stays hidden without a Library or when the Library keeps no computer list", () => {
    expect(content({ library: null, stored: everyone })).toEqual({ kind: "hidden" });
    expect(content({ supportsDirectory: false, stored: everyone })).toEqual({ kind: "hidden" });
  });

  it("lists only computers this device has not saved, once its saved connections load", () => {
    expect(content({ live: AsyncResult.success(everyone), savedReady: false })).toEqual({
      kind: "loading",
    });
    const listed = content({ live: AsyncResult.success(everyone) });
    expect(listed).toMatchObject({ kind: "computers", cacheText: null, error: null });
    expect(listed.kind === "computers" && listed.computers).toEqual([
      expect.objectContaining({
        row: expect.objectContaining({ environmentId: BOOK, label: "Book" }),
        description: "Linux · Reported 2 min ago",
        connectable: true,
      }),
    ]);
  });

  it("shows the kept list with its age and the error while the Library is unreachable", () => {
    expect(content({ live: offline, stored: everyone })).toMatchObject({
      kind: "computers",
      cacheText: "Showing the list from 3 hours ago",
      error: "Your Library is not reachable right now.",
      computers: [expect.objectContaining({ connectable: true })],
    });
    expect(content({ live: AsyncResult.initial(true), stored: everyone })).toMatchObject({
      kind: "computers",
      cacheText: "Showing the list from 3 hours ago",
      error: null,
    });
  });

  it("separates nothing yet, nothing new, and a failure with nothing kept", () => {
    expect(content({})).toEqual({ kind: "loading" });
    expect(content({ live: AsyncResult.success(kept([reported(STUDIO)])) })).toEqual({
      kind: "empty",
    });
    expect(content({ live: offline })).toEqual({
      kind: "failed",
      error: "Your Library is not reachable right now.",
    });
    // The read waits while the Library connection retries; the section still offers Try again.
    expect(content({ libraryRetrying: true })).toEqual({
      kind: "failed",
      error: "Your Library is not reachable right now.",
    });
  });

  it("keeps a computer with no usable address visible but not connectable", () => {
    const listed = content({
      live: AsyncResult.success(kept([reported(BOOK, { label: "Book", routes: [] })])),
    });
    expect(listed.kind === "computers" && listed.computers[0]).toMatchObject({
      description:
        "macOS · Reported 2 min ago · Turn on Tailscale HTTPS or Reach on Book, or pair instead",
      connectable: false,
    });
  });
});

describe("connecting a Library computer", () => {
  const row = (() => {
    const listed = content({
      live: AsyncResult.success(kept([reported(BOOK, { label: "Book" })])),
    });
    if (listed.kind !== "computers" || listed.computers[0] === undefined) throw new Error("no row");
    return listed.computers[0].row;
  })();
  const route = { kind: "tailnet", url: "https://book.example.ts.net" } as const;
  const signInStep: DirectoryConnectStep = {
    kind: "sign-in",
    surface: "native",
    environmentId: BOOK,
    route,
    issuer: ISSUER,
    request: { httpBaseUrl: route.url, expectedEnvironmentId: BOOK, expectedIdentity: ACCOUNT },
  };

  function signedIn(account: LoomIdentityAccount, environmentId = BOOK): NativeIdentitySignIn {
    const connectionId = `bearer:${environmentId}:${route.url}`;
    return {
      registration: new BearerConnectionRegistration({
        target: new BearerConnectionTarget({ environmentId, label: "Book", connectionId }),
        profile: new BearerConnectionProfile({
          connectionId,
          environmentId,
          label: "Book",
          httpBaseUrl: route.url,
          wsBaseUrl: "wss://book.example.ts.net/ws",
          identity: account,
        }),
        credential: new BearerConnectionCredential({
          token: "session",
          identity: { ...account, environmentId, expiresAt: NOW + 60 * MINUTE },
        }),
      }),
      grantKey: "grant",
      grant: null,
    };
  }

  function dependencies(
    step: DirectoryConnectStep | null,
    result: NativeIdentitySignIn | null = signedIn(ACCOUNT),
  ) {
    return {
      plan: vi.fn<DirectoryConnectDependencies["plan"]>(async () => AsyncResult.success(step)),
      signIn: vi.fn<DirectoryConnectDependencies["signIn"]>(async () => result),
      save: vi.fn<DirectoryConnectDependencies["save"]>(async () => {}),
    };
  }

  it("signs in pinned to the Library's issuer and account, then saves", async () => {
    const deps = dependencies(signInStep);
    await expect(
      connectDirectoryComputer({ row, libraryEnvironmentId: LIBRARY }, deps),
    ).resolves.toEqual({ kind: "connected" });
    expect(deps.plan).toHaveBeenCalledWith({
      row,
      signIn: { surface: "native" },
      libraryEnvironmentId: LIBRARY,
    });
    expect(deps.signIn).toHaveBeenCalledWith({
      httpBaseUrl: route.url,
      expectedEnvironmentId: BOOK,
      options: { requireSessionExchange: true, expectedIssuer: ISSUER, expectedIdentity: ACCOUNT },
      label: "Book",
    });
    expect(deps.save).toHaveBeenCalledOnce();
  });

  it("never saves a sign-in under another issuer, account or computer", async () => {
    for (const result of [
      signedIn({ issuer: "https://other-id.example.com", subject: "kyle" }),
      signedIn({ issuer: ISSUER, subject: "someone-else" }),
      signedIn(ACCOUNT, STUDIO),
    ]) {
      const deps = dependencies(signInStep, result);
      const outcome = await connectDirectoryComputer({ row, libraryEnvironmentId: LIBRARY }, deps);
      expect(outcome.kind).toBe("failed");
      expect(deps.save).not.toHaveBeenCalled();
    }
  });

  it("offers pairing without opening a sign-in, and saves nothing when the user cancels", async () => {
    const pairing: DirectoryConnectStep = {
      kind: "pairing",
      environmentId: BOOK,
      httpBaseUrl: route.url,
      reason: "issuer-mismatch",
      reasonText: "This computer uses a different sign-in provider than your Library.",
    };
    const pairingDeps = dependencies(pairing);
    await expect(
      connectDirectoryComputer({ row, libraryEnvironmentId: LIBRARY }, pairingDeps),
    ).resolves.toEqual({ kind: "pairing", step: pairing });
    expect(pairingDeps.signIn).not.toHaveBeenCalled();

    const cancelDeps = dependencies(signInStep, null);
    await expect(
      connectDirectoryComputer({ row, libraryEnvironmentId: LIBRARY }, cancelDeps),
    ).resolves.toEqual({ kind: "cancelled" });
    expect(cancelDeps.save).not.toHaveBeenCalled();
  });
});

describe("pairing a Library computer", () => {
  const step = (httpBaseUrl: string | null) =>
    ({
      kind: "pairing",
      environmentId: BOOK,
      httpBaseUrl,
      reason: "library-issuer-unknown",
      reasonText: "Loom could not confirm your Library's sign-in provider.",
    }) as const;

  it("expects the listed computer and offers no Identity sign-in", () => {
    const pairing = directoryPairing(step("https://book.example.ts.net"));
    expect(pairing.httpBaseUrl).toBe("https://book.example.ts.net");
    expect(pairingFormChecks(pairing.params)).toEqual({
      expectedEnvironmentId: BOOK,
      offersIdentity: false,
    });
  });

  it("leaves the address empty when every listed one reached another computer", () => {
    expect(directoryPairing(step(null))).toEqual({
      httpBaseUrl: "",
      params: { libraryComputer: BOOK },
    });
  });

  it("drops the computer's address once its form closes, and keeps any other pending address", () => {
    let pending = "https://plain.example.ts.net";
    const address = directoryPairingAddress((next) => {
      pending = next;
    });
    address.close();
    expect(pending).toBe("https://plain.example.ts.net");

    address.open(directoryPairing(step("https://book.example.ts.net")));
    expect(pending).toBe("https://book.example.ts.net");
    address.close();
    expect(pending).toBe("");

    pending = "https://plain.example.ts.net";
    address.close();
    expect(pending).toBe("https://plain.example.ts.net");
  });

  it("leaves ordinary pairing and adding an address unchanged", () => {
    expect(pairingFormChecks({})).toEqual({
      expectedEnvironmentId: undefined,
      offersIdentity: true,
    });
    expect(pairingFormChecks({ routeFor: STUDIO })).toEqual({
      expectedEnvironmentId: STUDIO,
      offersIdentity: true,
    });
  });
});
