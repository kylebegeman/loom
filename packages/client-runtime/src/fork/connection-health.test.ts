import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import { BearerConnectionProfile, type ConnectionCatalogEntry } from "../connection/catalog.ts";
import { BearerConnectionTarget, RelayConnectionTarget } from "../connection/model.ts";

import {
  CONNECTION_STALL_MS,
  computerConnectionNextStep,
  computerDirectoryHealth,
  connectionStallAt,
  isConnectionStalled,
  tailnetOnlyConnectionHint,
} from "./connection-health.ts";
import {
  BOOK,
  DESK,
  LIBRARY,
  MINUTES,
  NOW,
  ago,
  listing,
  reported,
} from "./directory-test-fixtures.ts";

describe("connection stall", () => {
  it("stalls a reconnect only after it has failed for the stall window", () => {
    const reconnecting = { phase: "reconnecting", failingSince: NOW } as const;
    expect(connectionStallAt(reconnecting)).toBe(NOW + CONNECTION_STALL_MS);
    expect(isConnectionStalled(reconnecting, NOW + CONNECTION_STALL_MS - 1)).toBe(false);
    expect(isConnectionStalled(reconnecting, NOW + CONNECTION_STALL_MS)).toBe(true);
    // "Retry now" starts a fresh first attempt, which still belongs to the same run of failures.
    expect(isConnectionStalled({ ...reconnecting, phase: "connecting" }, NOW + 2 * MINUTES)).toBe(
      true,
    );
  });

  it("never stalls a first connection, a blocked one or one with no failure", () => {
    expect(connectionStallAt({ phase: "connecting" })).toBeNull();
    expect(connectionStallAt({ phase: "error", failingSince: NOW })).toBeNull();
    expect(connectionStallAt({ phase: "offline" })).toBeNull();
  });
});

describe("computer directory health", () => {
  it("uses a recent live report without claiming this device can reach the computer", () => {
    expect(
      computerDirectoryHealth({
        listing: listing([reported(BOOK, { reportedAt: ago(MINUTES) })]),
        environmentId: BOOK,
        label: "Book",
        now: NOW,
      }),
    ).toEqual({ text: "Reporting normally, last seen 1 minute ago.", attention: null });
    expect(
      computerDirectoryHealth({
        listing: listing([reported(BOOK, { reportedAt: ago(MINUTES) })]),
        environmentId: BOOK,
        label: "Book",
        now: NOW,
        source: "cache",
      }),
    ).toEqual({ text: "Last reported 1 minute ago.", attention: null });
  });

  it("gives an older report's age and names providers that need attention", () => {
    expect(
      computerDirectoryHealth({
        listing: listing([
          reported(BOOK, {
            reportedAt: ago(180 * MINUTES),
            providers: [
              { id: ProviderInstanceId.make("codex"), status: "error" },
              { id: ProviderInstanceId.make("claudeAgent"), status: "ready" },
              { id: ProviderInstanceId.make("cursor"), status: "warning" },
            ],
          }),
        ]),
        environmentId: BOOK,
        label: "Book",
        now: NOW,
      }),
    ).toEqual({
      text: "Last reported 3 hours ago.",
      attention: "Codex and Cursor need attention on Book.",
    });
  });

  it("says nothing about a computer the directory does not list", () => {
    expect(
      computerDirectoryHealth({
        listing: listing([reported(DESK)]),
        environmentId: BOOK,
        label: "Book",
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("tailnet-only connection advice", () => {
  const route = (id: string, marked: boolean, url = "https://book.example.ts.net") => ({
    target: new BearerConnectionTarget({ environmentId: BOOK, label: "Book", connectionId: id }),
    profile: Option.some(
      new BearerConnectionProfile({
        environmentId: BOOK,
        label: "Book",
        connectionId: id,
        httpBaseUrl: url,
        wsBaseUrl: url.replace("https:", "wss:"),
        ...(marked ? { network: "tailscale" as const } : {}),
      }),
    ),
  });
  const entry: ConnectionCatalogEntry = { ...route("one", true), enabled: true };
  it("uses every saved route's explicit network marker, including alternatives", () => {
    const failed = { phase: "reconnecting" as const };
    expect(tailnetOnlyConnectionHint(entry, failed)).toBe("Turn on Tailscale on this device.");
    expect(
      tailnetOnlyConnectionHint({ ...entry, alternateRoutes: [route("two", true)] }, failed),
    ).not.toBeNull();
    expect(
      tailnetOnlyConnectionHint(
        { ...entry, alternateRoutes: [route("public", false, "https://book.example.com")] },
        failed,
      ),
    ).toBeNull();
    expect(
      tailnetOnlyConnectionHint(
        {
          ...entry,
          alternateRoutes: [
            {
              target: new RelayConnectionTarget({ environmentId: BOOK, label: "Book" }),
              profile: Option.none(),
            },
          ],
        },
        failed,
      ),
    ).toBeNull();
    expect(
      tailnetOnlyConnectionHint(
        { ...route("unmarked", false, "https://100.64.0.1"), enabled: true },
        failed,
      ),
    ).toBeNull();
  });
  it("does not diagnose an offline device, a healthy or disabled connection, or refused sign-in", () => {
    for (const phase of [
      "connected",
      "offline",
      "available",
      "unsupported",
      "error",
      "connecting",
    ] as const) {
      expect(tailnetOnlyConnectionHint(entry, { phase })).toBeNull();
    }
    expect(
      tailnetOnlyConnectionHint(entry, { phase: "error", blockedReason: "authentication" }),
    ).toBeNull();
    expect(
      tailnetOnlyConnectionHint({ ...entry, enabled: false }, { phase: "reconnecting" }),
    ).toBeNull();
    expect(
      tailnetOnlyConnectionHint(entry, { phase: "connecting", failingSince: NOW }),
    ).not.toBeNull();
  });
});

describe("computer connection next step", () => {
  const saved = (
    connectionId: string,
    extra: Partial<ConstructorParameters<typeof BearerConnectionProfile>[0]> = {},
  ): ConnectionCatalogEntry => ({
    target: new BearerConnectionTarget({ environmentId: BOOK, label: "Book", connectionId }),
    profile: Option.some(
      new BearerConnectionProfile({
        environmentId: BOOK,
        label: "Book",
        connectionId,
        httpBaseUrl: "https://library.example.com/api/loom/account/computers/book/",
        wsBaseUrl: "wss://library.example.com/api/loom/account/computers/book/",
        ...extra,
      }),
    ),
    enabled: true,
  });
  const account = saved("account", {
    account: { libraryEnvironmentId: LIBRARY, connectionId: null },
  });
  const failed = { phase: "reconnecting", error: "HTTP 503" } as const;
  const step = (
    entry: ConnectionCatalogEntry,
    connection: Parameters<typeof computerConnectionNextStep>[0]["connection"],
    directory: Parameters<typeof computerConnectionNextStep>[0]["listing"] = null,
  ) => computerConnectionNextStep({ label: "Book", entry, connection, listing: directory });

  it("asks for remote access or pairing when the Library lists no address for an account computer", () => {
    const pair = {
      action: "pair",
      text: "Turn on Tailscale HTTPS or Loomhost on Book, or pair instead.",
    };
    expect(step(account, failed, listing([reported(BOOK, { routes: [] })]))).toEqual(pair);
    // A computer that just joined has not reported yet.
    expect(step(account, failed, listing([reported(DESK)]))).toEqual(pair);
    expect(step(account, failed, listing([reported(BOOK)]))).toEqual({
      action: "reconnect",
      text: "HTTP 503",
    });
    // Without a listing, the Library itself may be what is unreachable.
    expect(step(account, failed)).toEqual({ action: "reconnect", text: "HTTP 503" });
    expect(step(saved("lan"), failed, listing([reported(BOOK, { routes: [] })]))).toEqual({
      action: "reconnect",
      text: "HTTP 503",
    });
  });

  it("gives every failing connection a reason and a way forward", () => {
    for (const connection of [
      { phase: "reconnecting" },
      { phase: "error" },
      { phase: "connecting", failingSince: NOW },
    ] as const)
      expect(step(account, connection)).toEqual({
        action: "reconnect",
        text: "Loom can't reach Book.",
      });
    expect(step(account, { phase: "unsupported" })).toEqual({
      action: "reconnect",
      text: "Book and this device run Loom versions that cannot connect. Update Loom, then reconnect.",
    });
    expect(
      step(saved("identity", { identity: { issuer: "https://id.example", subject: "me" } }), {
        phase: "error",
        blockedReason: "authentication",
      }),
    ).toEqual({ action: "sign-in", text: "Your sign-in to Book expired. Sign in again." });
    expect(
      step(saved("paired"), { phase: "error", blockedReason: "authentication", error: "Revoked" }),
    ).toEqual({ action: "pair", text: "Revoked" });
  });

  it("stays quiet while the connection is healthy, starting, offline or switched off", () => {
    for (const phase of ["connected", "available", "offline", "connecting"] as const)
      expect(step(account, { phase })).toBeNull();
    expect(step({ ...account, enabled: false }, failed)).toBeNull();
  });
});
