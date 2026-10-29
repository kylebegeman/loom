import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import { BearerConnectionProfile, type ConnectionCatalogEntry } from "../connection/catalog.ts";
import { BearerConnectionTarget, RelayConnectionTarget } from "../connection/model.ts";

import {
  CONNECTION_STALL_MS,
  computerDirectoryHealth,
  connectionStallAt,
  isConnectionStalled,
  tailnetOnlyConnectionHint,
} from "./connection-health.ts";
import { BOOK, DESK, MINUTES, NOW, ago, listing, reported } from "./directory-test-fixtures.ts";

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
