import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  CONNECTION_STALL_MS,
  computerDirectoryHealth,
  connectionStallAt,
  isConnectionStalled,
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
  it("says a computer that reported moments ago is running but unreachable from here", () => {
    expect(
      computerDirectoryHealth({
        listing: listing([reported(BOOK, { reportedAt: ago(MINUTES) })]),
        environmentId: BOOK,
        label: "Book",
        now: NOW,
      }),
    ).toEqual({ text: "Running, but not reachable from here.", attention: null });
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
