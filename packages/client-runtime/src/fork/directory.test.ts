import { describe, expect, it } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { type DirectoryReporting, type DirectoryRoute } from "@t3tools/contracts/fork";

import {
  directoryAgeText,
  directoryCatalogRows,
  directoryConnectPlan,
  backgroundCheckFailureText,
  directoryProofAge,
  directoryReportingText,
  directoryReportingView,
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
    expect(directoryAgeText(2 * MINUTES)).toBe("2 minutes ago");
    expect(directoryAgeText(60 * MINUTES)).toBe("1 hour ago");
    expect(directoryAgeText(3 * 60 * MINUTES)).toBe("3 hours ago");
    expect(directoryAgeText(49 * 60 * MINUTES)).toBe("2 days ago");
  });
});

describe("directoryProofAge", () => {
  it("counts a report within two minutes as recent, like the Library's online window", () => {
    expect(directoryProofAge(ago(2 * MINUTES), NOW)).toMatchObject({
      recent: true,
      text: "Reported 2 minutes ago",
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
      proof: { text: "Reported 1 minute ago" },
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
  const report = { state: "reporting", lastReportedAt: ago(3 * MINUTES) } as const;
  const signIn = {
    state: "ready",
    expiresAt: "2026-10-22T12:00:00.000Z",
    renewsAt: "2026-10-21T12:00:00.000Z",
    renewal: "automatic",
    repair: null,
  } as const;

  it("names each reporting state without exposing its enum", () => {
    const cases: readonly [DirectoryReporting["state"], string][] = [
      ["off", "This computer is not reporting to a Library."],
      ["unsupported", "Update your Library to receive this computer's reports."],
      ["reporting", "Reporting normally, last seen 3 minutes ago."],
      [
        "retrying",
        "Can't report to your Library. Loom will try again. Last reported 3 minutes ago.",
      ],
      [
        "key-changed",
        "This computer's sign-in key changed. Forget it in your Library to accept its new key.",
      ],
      ["signed-out", "This computer needs to sign in to your Library again."],
    ];
    for (const [state, text] of cases) {
      expect(directoryReportingText({ ...report, state }, NOW)[0]).toBe(text);
    }
    expect(
      directoryReportingText(
        { ...report, state: "off", signIn: { ...signIn, state: "authority" } },
        NOW,
      )[0],
    ).toBe("This computer is your Library.");
    expect(directoryReportingText({ ...report, lastReportedAt: null }, NOW)[0]).toBe(
      "Waiting for this computer's first report.",
    );
  });

  it("uses relative times across minute, hour and day boundaries, including clock skew", () => {
    for (const [age, text] of [
      [0, "just now"],
      [MINUTES, "1 minute ago"],
      [60 * MINUTES, "1 hour ago"],
      [2 * 24 * 60 * MINUTES, "2 days ago"],
      [-MINUTES, "just now"],
    ] as const) {
      expect(directoryReportingText({ ...report, lastReportedAt: ago(age) }, NOW)[0]).toBe(
        `Reporting normally, last seen ${text}.`,
      );
    }
  });

  it("distinguishes first, completed and older-server automatic renewals", () => {
    const lines = (renewedAt?: string | null) =>
      directoryReportingText(
        { ...report, signIn: { ...signIn, ...(renewedAt === undefined ? {} : { renewedAt }) } },
        NOW,
      );
    expect(lines(null)).toContain("Library sign-in expires in 2 days. First renewal due in 1 day.");
    expect(lines(ago(60 * MINUTES))).toContain(
      "Library sign-in expires in 2 days. Last renewed 1 hour ago. Next renewal due in 1 day.",
    );
    expect(lines()).toContain("Library sign-in expires in 2 days. Renews automatically.");
    expect(
      directoryReportingText(
        { ...report, signIn: { ...signIn, renewsAt: ago(MINUTES), renewedAt: null } },
        NOW,
      ),
    ).toContain("Library sign-in expires in 2 days. First renewal was due 1 minute ago.");
  });

  it("keeps renewal failures and expired sign-ins actionable in owner language", () => {
    expect(
      directoryReportingText({ ...report, signIn: { ...signIn, renewal: "retrying" } }, NOW),
    ).toContain("Can't renew this computer's Library sign-in. Loom will try again.");
    expect(
      directoryReportingText({ ...report, signIn: { ...signIn, renewal: "unsupported" } }, NOW),
    ).toContain("Update Loom on your Library to renew this sign-in automatically.");
    const expired = directoryReportingText(
      {
        ...report,
        state: "signed-out",
        signIn: {
          ...signIn,
          state: "expired",
          expiresAt: ago(60 * MINUTES),
          repair: "Ask your Library administrator to replace its publisher credential.",
        },
      },
      NOW,
    );
    expect(expired).toContain("Library sign-in expired 1 hour ago.");
    expect(expired).toContain("Reconnect this computer to your Library in Settings > Computers.");
    expect(expired.join(" ")).not.toContain("administrator");
  });
});

describe("backgroundCheckFailureText", () => {
  it("keeps the reason and repeated-failure history in relative time, then clears it", () => {
    const report = { state: "reporting", lastReportedAt: null } as const;
    expect(
      backgroundCheckFailureText(
        {
          ...report,
          failingChecks: [
            {
              check: "library-renewal",
              message: "Check the Library connection.",
              firstSeenAt: ago(24 * 60 * MINUTES),
              lastSeenAt: ago(3 * MINUTES),
              count: 5,
            },
            {
              check: "preview-registration",
              message: "The Library could not be reached.",
              firstSeenAt: ago(MINUTES),
              lastSeenAt: ago(MINUTES),
              count: 1,
            },
          ],
        },
        NOW,
      ),
    ).toEqual([
      "Library sign-in renewal has failed 5 times since 1 day ago, most recently 3 minutes ago: Check the Library connection.",
      "Preview sharing failed 1 minute ago: The Library could not be reached.",
    ]);
    expect(backgroundCheckFailureText(report, NOW)).toEqual([]);
  });
});

describe("directoryReportingView", () => {
  it("labels a retained report after refresh fails and hides it while disconnected", () => {
    const report = { state: "reporting", lastReportedAt: ago(MINUTES) } as const;
    const result = AsyncResult.failureWithPrevious(Cause.fail("unreachable"), {
      previous: Option.some(AsyncResult.success(report)),
    });
    expect(directoryReportingView(result, true)).toEqual({
      report,
      stale: true,
      notice: "Could not refresh this computer's Library status. Try again.",
    });
    expect(directoryReportingView(result, false)).toEqual({
      report: null,
      stale: false,
      notice: "Reconnect to check this computer's Library sign-in.",
    });
    expect(directoryReportingView(AsyncResult.success(report), true)).toEqual({
      report,
      stale: false,
      notice: null,
    });
    expect(directoryReportingView(AsyncResult.initial(), true).notice).toBe(
      "Checking Library status...",
    );
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
