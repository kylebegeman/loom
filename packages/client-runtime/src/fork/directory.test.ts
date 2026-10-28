import { describe, expect, it } from "vite-plus/test";
import { type DirectoryRoute } from "@t3tools/contracts/fork";

import {
  directoryAgeText,
  directoryCatalogRows,
  directoryConnectPlan,
  backgroundCheckFailureText,
  directoryProofAge,
  directoryReportingText,
  directoryRoutes,
  directoryUnattachedMachines,
  directoryOldMachines,
  identityDirectoryAddresses,
} from "./directory.ts";
import {
  APP_ORIGIN,
  BOOK,
  DESK,
  LIBRARY,
  LIBRARY_ISSUER,
  MINUTES,
  NOW,
  STUDIO,
  ago,
  identity,
  listing,
  machine,
  reported,
} from "./directory-test-fixtures.ts";

const native = { signIn: { surface: "native" }, libraryIssuer: LIBRARY_ISSUER } as const;

/** A saved connection as a client holds it, with routes the directory must never touch. */
const savedStudio = {
  environmentId: STUDIO,
  label: "Studio (saved)",
  httpBaseUrl: "https://studio.saved.example.com",
  wsBaseUrl: "wss://studio.saved.example.com/ws",
};

describe("directoryAgeText", () => {
  it("reads in the largest whole unit", () => {
    expect(directoryAgeText(20_000)).toBe("just now");
    expect(directoryAgeText(2 * MINUTES)).toBe("2 min ago");
    expect(directoryAgeText(60 * MINUTES)).toBe("1 hour ago");
    expect(directoryAgeText(3 * 60 * MINUTES)).toBe("3 hours ago");
    expect(directoryAgeText(49 * 60 * MINUTES)).toBe("2 days ago");
  });
});

describe("directoryProofAge", () => {
  it("counts a report within two minutes as recent, like the Library's online window", () => {
    expect(directoryProofAge(ago(2 * MINUTES), NOW)).toMatchObject({
      recent: true,
      text: "Reported 2 min ago",
    });
    expect(directoryProofAge(ago(2 * MINUTES + 1), NOW)?.recent).toBe(false);
  });

  it("reads a report from a clock running ahead as just now", () => {
    expect(directoryProofAge(ago(-5 * MINUTES), NOW)).toMatchObject({
      ageMs: 0,
      text: "Reported just now",
    });
  });

  it("has no age for an unreadable time", () => {
    expect(directoryProofAge("yesterday", NOW)).toBeNull();
  });
});

describe("directoryRoutes", () => {
  it("drops every route that is not a DNS name over HTTPS, even from a malformed listing", () => {
    const routes = [
      { kind: "tailnet", url: "https://studio.example.ts.net" },
      { kind: "public", url: "http://studio.example.com" },
      { kind: "public", url: "https://192.168.1.20" },
      { kind: "tailnet", url: "https://100.64.0.7:3773" },
      { kind: "public", url: "https://[fd7a:115c::1]" },
      { kind: "public", url: "https://localhost.example.com" },
      { kind: "public", url: "https://user:secret@studio.example.com" },
      { kind: "public", url: "https://studio.example.com?token=1" },
      { kind: "lan", url: "https://studio.example.org" },
      { kind: "tailnet", url: "https://studio.example.ts.net" },
      { kind: "public", url: "https://studio.example.com" },
    ] as unknown as readonly DirectoryRoute[];
    expect(directoryRoutes(routes)).toEqual([
      { kind: "public", url: "https://studio.example.com" },
      { kind: "tailnet", url: "https://studio.example.ts.net" },
    ]);
  });
});

describe("directoryCatalogRows", () => {
  it("keeps one row per environment, from its newest report", () => {
    const rows = directoryCatalogRows({
      listing: listing([
        reported(BOOK, {
          sequence: 4,
          routes: [{ kind: "tailnet", url: "https://book-old.example.ts.net" }],
        }),
        reported(BOOK, {
          sequence: 9,
          routes: [{ kind: "public", url: "https://book.example.com" }],
        }),
      ]),
      saved: [],
      connected: [],
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      environmentId: BOOK,
      saved: null,
      routes: [{ kind: "public", url: "https://book.example.com" }],
      action: "connect",
    });
    expect(rows[0]?.report?.sequence).toBe(9);
  });

  it("breaks a sequence tie by the later receipt", () => {
    const rows = directoryCatalogRows({
      listing: listing([
        reported(BOOK, { label: "Earlier", receivedAt: ago(3 * MINUTES) }),
        reported(BOOK, { label: "Later", receivedAt: ago(MINUTES) }),
      ]),
      saved: [],
      connected: [],
      now: NOW,
    });
    expect(rows.map((row) => row.label)).toEqual(["Later"]);
  });

  it("annotates a saved connection without changing its routes", () => {
    const rows = directoryCatalogRows({
      listing: listing([
        reported(STUDIO, {
          label: "Studio",
          routes: [
            { kind: "public", url: "https://studio.elsewhere.example.com" },
            { kind: "tailnet", url: "https://studio.example.ts.net" },
          ],
        }),
      ]),
      saved: [savedStudio],
      connected: [],
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.saved).toBe(savedStudio);
    expect(savedStudio.httpBaseUrl).toBe("https://studio.saved.example.com");
    expect(row).toMatchObject({
      label: "Studio (saved)",
      routes: [],
      action: null,
      proof: { text: "Reported 1 min ago" },
    });
    expect(row?.report).not.toHaveProperty("routes");
    expect(row && directoryConnectPlan(row, identity(STUDIO), native)).toBeNull();
  });

  it("lists saved connections first in their order, then discovered computers by label", () => {
    const rows = directoryCatalogRows({
      listing: listing([reported(DESK, { label: "Desk" }), reported(BOOK, { label: "Book" })]),
      saved: [savedStudio, { environmentId: DESK, label: "Desk" }, savedStudio],
      connected: [],
      now: NOW,
    });
    expect(rows.map((row) => [row.environmentId, row.saved === null])).toEqual([
      [STUDIO, false],
      [DESK, false],
      [BOOK, true],
    ]);
    expect(rows[0]?.report).toBeNull();
  });

  it("is online only when this device is connected, however recent the report", () => {
    const rows = directoryCatalogRows({
      listing: listing([reported(BOOK, { reportedAt: ago(0) }), reported(DESK)]),
      saved: [],
      connected: [DESK],
      now: NOW,
    });
    expect(rows.map((row) => [row.environmentId, row.proof?.recent, row.connected])).toEqual([
      [BOOK, true, false],
      [DESK, true, true],
    ]);
  });

  it("offers pairing when no route survives", () => {
    const [row] = directoryCatalogRows({
      listing: listing([reported(BOOK, { routes: [{ kind: "public", url: "https://10.0.0.4" }] })]),
      saved: [],
      connected: [],
      now: NOW,
    });
    expect(row).toMatchObject({ routes: [], action: "pair" });
    expect(row && directoryConnectPlan(row, null, native)).toBeNull();
  });

  it("attaches LoomOS machines to the computer that reported them", () => {
    const mini = machine(BOOK);
    const orphan = machine(DESK, { keyFingerprint: "c".repeat(64) });
    const current = listing([reported(BOOK), reported(STUDIO)], [mini, orphan]);
    const rows = directoryCatalogRows({
      listing: current,
      saved: [savedStudio],
      connected: [],
      now: NOW,
    });
    expect(rows.map((row) => [row.environmentId, row.machines])).toEqual([
      [STUDIO, []],
      [BOOK, [mini]],
    ]);
    expect(directoryUnattachedMachines(current)).toEqual([orphan]);
  });

  it("keeps saved rows when no listing is known", () => {
    const rows = directoryCatalogRows({
      listing: null,
      saved: [savedStudio],
      connected: [STUDIO],
      now: NOW,
    });
    expect(rows).toEqual([
      {
        environmentId: STUDIO,
        label: "Studio (saved)",
        saved: savedStudio,
        report: null,
        routes: [],
        machines: [],
        connected: true,
        proof: null,
        action: null,
      },
    ]);
  });
});

describe("directoryConnectPlan", () => {
  const [row] = directoryCatalogRows({
    listing: listing([
      reported(BOOK, {
        routes: [
          { kind: "tailnet", url: "https://book.example.ts.net" },
          { kind: "public", url: "https://book.example.com" },
        ],
      }),
    ]),
    saved: [],
    connected: [],
    now: NOW,
  });
  if (row === undefined) throw new Error("expected a discovered row");
  const browser = {
    signIn: { surface: "browser", origin: APP_ORIGIN },
    libraryIssuer: LIBRARY_ISSUER,
  } as const;

  it("tries the public route first, then tailnet", () => {
    expect(directoryConnectPlan(row, null, native)).toEqual({
      environmentId: BOOK,
      routes: [
        { kind: "public", url: "https://book.example.com" },
        { kind: "tailnet", url: "https://book.example.ts.net" },
      ],
      signIn: "pairing",
      reason: "no-sign-in",
    });
  });

  it("has a browser try tailnet first, since a public reach address serves no browser sign-in", () => {
    expect(directoryConnectPlan(row, null, browser)?.routes).toEqual([
      { kind: "tailnet", url: "https://book.example.ts.net" },
      { kind: "public", url: "https://book.example.com" },
    ]);
  });

  it("signs in with Loom Identity when the computer offers it here", () => {
    expect(directoryConnectPlan(row, identity(BOOK), browser)).toMatchObject({
      signIn: "loom-identity",
      reason: null,
    });
    expect(directoryConnectPlan(row, identity(BOOK), native)?.signIn).toBe("loom-identity");
    const { nativeClientId: _native, ...browserOnly } = identity(BOOK);
    expect(directoryConnectPlan(row, browserOnly, native)?.reason).toBe("not-here");
  });

  it("keeps a browser on pairing where the computer does not allow its origin", () => {
    for (const metadata of [
      identity(BOOK, { browserLoginEnabled: false }),
      identity(BOOK, { browserOrigins: ["https://elsewhere.example.com"] }),
      identity(BOOK, { sessionExchangeEnabled: false }),
    ]) {
      expect(directoryConnectPlan(row, metadata, browser)?.reason).toBe("not-here");
    }
  });

  it("pairs when sign-in is off or the route reaches another computer", () => {
    expect(directoryConnectPlan(row, identity(BOOK, { enabled: false }), browser)?.reason).toBe(
      "no-sign-in",
    );
    expect(directoryConnectPlan(row, identity(BOOK, { tokenEndpoint: null }), native)?.reason).toBe(
      "no-sign-in",
    );
    expect(directoryConnectPlan(row, identity(STUDIO), browser)?.reason).toBe("other-computer");
  });

  it("offers Loom Identity only under the Library's own issuer", () => {
    const elsewhere = identity(BOOK, { issuer: "https://login.attacker.example" });
    expect(directoryConnectPlan(row, elsewhere, native)).toMatchObject({
      signIn: "pairing",
      reason: "issuer-mismatch",
    });
    expect(
      directoryConnectPlan(row, identity(BOOK), { ...native, libraryIssuer: null }),
    ).toMatchObject({ signIn: "pairing", reason: "library-issuer-unknown" });
  });
});

describe("directory resource check", () => {
  const BOOK_RESOURCE = "https://library.example.com/computers/book";
  const DESK_RESOURCE = "https://library.example.com/computers/desk";
  const browser = {
    signIn: { surface: "browser", origin: APP_ORIGIN },
    libraryIssuer: LIBRARY_ISSUER,
  } as const;
  const rowFor = (environments: Parameters<typeof listing>[0]) => {
    const row = directoryCatalogRows({
      listing: listing(environments),
      saved: [],
      connected: [],
      now: NOW,
    }).find((candidate) => candidate.environmentId === BOOK);
    if (row === undefined) throw new Error("expected Book's row");
    return row;
  };

  it("signs in while a computer moves to its own resource and back", () => {
    const row = rowFor([reported(BOOK), reported(DESK)]);
    for (const fields of [
      {},
      { resource: BOOK_RESOURCE },
      { audience: BOOK_RESOURCE, resource: BOOK_RESOURCE },
    ]) {
      expect(directoryConnectPlan(row, identity(BOOK, fields), native)).toMatchObject({
        signIn: "loom-identity",
        reason: null,
      });
    }
  });

  it("pairs with a computer naming another computer's resource", () => {
    const row = rowFor([reported(BOOK), reported(DESK)]);
    expect(
      directoryConnectPlan(row, identity(BOOK, { resource: DESK_RESOURCE }), native)?.reason,
    ).toBe("resource-mismatch");
    expect(directoryConnectPlan(row, identity(BOOK, { audience: DESK_RESOURCE }), browser)).toEqual(
      expect.objectContaining({ signIn: "pairing", reason: "resource-mismatch" }),
    );
  });
});

describe("identityDirectoryAddresses", () => {
  const library = {
    environmentId: LIBRARY,
    label: "Helios",
    addresses: ["https://library.example.com/", "https://library.example.com/"],
  };

  it("keeps every route of each computer's newest report, usable or not", () => {
    const addresses = identityDirectoryAddresses({
      library,
      listing: listing([
        reported(BOOK, {
          sequence: 1,
          label: "Old Book",
          routes: [{ kind: "public", url: "https://old-book.example.com" }],
        }),
        reported(BOOK, {
          sequence: 2,
          label: "Book",
          routes: [
            { kind: "public", url: "https://book.example.com" },
            { kind: "tailnet", url: "https://book.example.ts.net" },
            { kind: "public", url: "https://book.example.com" },
            // A browser cannot use these, but they are still this computer's own addresses.
            { kind: "tailnet", url: "https://100.64.0.7:3773" },
          ],
        }),
        reported(DESK, { routes: [] }),
      ]),
    });
    expect(addresses).toEqual({
      library: {
        environmentId: LIBRARY,
        label: "Helios",
        addresses: ["https://library.example.com/"],
      },
      computers: [
        {
          environmentId: BOOK,
          label: "Book",
          addresses: [
            "https://book.example.com",
            "https://book.example.ts.net",
            "https://100.64.0.7:3773",
          ],
        },
        { environmentId: DESK, label: DESK, addresses: [] },
      ],
    });
  });

  it("still knows the Library's own addresses before any listing", () => {
    expect(identityDirectoryAddresses({ library, listing: null })).toEqual({
      library: { ...library, addresses: ["https://library.example.com/"] },
      computers: [],
    });
  });
});

describe("directoryReportingText", () => {
  const signIn = {
    state: "ready",
    expiresAt: "2026-11-24T12:00:00.000Z",
    renewsAt: "2026-11-05T12:00:00.000Z",
    renewal: "automatic",
    repair: null,
  } as const;
  const signInLine = (renewedAt?: string | null) =>
    directoryReportingText({
      state: "reporting",
      lastReportedAt: null,
      routes: [],
      signIn: renewedAt === undefined ? signIn : { ...signIn, renewedAt },
    }).find((line) => line.startsWith("Library sign-in"));

  it("names the first renewal until one succeeds, then the last one", () => {
    expect(signInLine(null)).toBe(
      "Library sign-in expires 2026-11-24T12:00:00.000Z. First renewal scheduled for 2026-11-05T12:00:00.000Z.",
    );
    expect(signInLine("2026-10-26T09:00:00.000Z")).toBe(
      "Library sign-in expires 2026-11-24T12:00:00.000Z. Last renewed 2026-10-26T09:00:00.000Z. Next renewal 2026-11-05T12:00:00.000Z.",
    );
  });

  it("keeps the older wording for a server that does not report renewals", () => {
    expect(signInLine()).toBe(
      "Library sign-in expires 2026-11-24T12:00:00.000Z. Renews automatically.",
    );
  });
});

describe("backgroundCheckFailureText", () => {
  it("says since when a check has failed and why, and nothing once it passes", () => {
    const report = { state: "reporting", lastReportedAt: null } as const;
    expect(
      backgroundCheckFailureText({
        ...report,
        failingChecks: [
          {
            check: "tailscale-cli",
            message: "Loom is not allowed to run the Tailscale CLI (tailscale).",
            firstSeenAt: "2026-09-23T06:21:00.000Z",
            lastSeenAt: "2026-10-26T09:15:00.000Z",
            count: 95_000,
          },
          {
            check: "preview-registration",
            message: "Could not reach the Library to register this computer's previews.",
            firstSeenAt: "2026-10-26T09:00:00.000Z",
            lastSeenAt: "2026-10-26T09:00:00.000Z",
            count: 1,
          },
        ],
      }),
    ).toEqual([
      "Tailscale CLI has failed 95000 times since 2026-09-23T06:21:00.000Z, most recently at 2026-10-26T09:15:00.000Z: Loom is not allowed to run the Tailscale CLI (tailscale).",
      "Preview registration failed at 2026-10-26T09:00:00.000Z: Could not reach the Library to register this computer's previews.",
    ]);
    expect(backgroundCheckFailureText(report)).toEqual([]);
  });
});

describe("directoryOldMachines", () => {
  it("includes computers at the thirty-day boundary and machines without a reporter", () => {
    const month = 30 * 24 * 60 * MINUTES;
    const stale = reported(STUDIO, { receivedAt: ago(month) });
    const fresh = reported(BOOK, { receivedAt: ago(month - 1) });
    const orphan = machine(DESK);
    const result = directoryOldMachines(listing([fresh, stale], [machine(STUDIO), orphan]), NOW);
    expect(result.environments).toEqual([stale]);
    expect(result.machines).toEqual([orphan]);
  });
});
