import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { BearerConnectionProfile } from "../connection/catalog.ts";
import { BearerConnectionTarget } from "../connection/model.ts";
import type { ConnectionRoute } from "../connection/catalog.ts";
import { mergeLearnedRoutes } from "../connection/routes.ts";
import {
  directoryCatalogRows,
  type DirectoryCatalogRow,
  type DirectorySignIn,
} from "./directory.ts";
import {
  directoryLibraryTrust,
  directorySignInMismatch,
  resolveDirectoryConnect,
  savedIdentitySignIn,
  type DirectoryConnectStep,
  type DirectoryLibraryTrust,
} from "./directory-computers-connect.ts";
import {
  APP_ORIGIN,
  BOOK,
  LIBRARY,
  LIBRARY_ISSUER,
  NOW,
  STUDIO,
  identity,
  listing,
  reported,
} from "./directory-test-fixtures.ts";

const PUBLIC = "https://book.example.com";
const TAILNET = "https://book.example.ts.net";
const LIBRARY_URL = "https://library.example.com";
const ACCOUNT = { issuer: LIBRARY_ISSUER, subject: "kyle" };
const native = { surface: "native" } as const;
const browser = { surface: "browser", origin: APP_ORIGIN } as const;

const [bookRow] = directoryCatalogRows({
  listing: listing([
    reported(BOOK, {
      routes: [
        { kind: "tailnet", url: TAILNET },
        { kind: "public", url: PUBLIC },
      ],
    }),
  ]),
  saved: [],
  connected: [],
  now: NOW,
});
if (bookRow === undefined) throw new Error("expected a discovered row");

const signedInLibrary: DirectoryLibraryTrust = {
  environmentId: LIBRARY,
  account: ACCOUNT,
  httpBaseUrls: [LIBRARY_URL],
};
const pairedLibrary: DirectoryLibraryTrust = { ...signedInLibrary, account: null };

/** Answers each origin's metadata path; anything unlisted fails like an unreachable address. */
function serve(answers: Record<string, () => Response>) {
  const requested: string[] = [];
  const client = HttpClient.make((request) => {
    const origin = new URL(request.url).origin;
    requested.push(origin);
    const answer = answers[origin];
    return answer === undefined
      ? Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request }),
          }),
        )
      : Effect.succeed(HttpClientResponse.fromWeb(request, answer()));
  });
  return { client, requested };
}

const resolve = (
  answers: Record<string, () => Response>,
  library: DirectoryLibraryTrust,
  row: DirectoryCatalogRow = bookRow,
  signIn: DirectorySignIn = native,
) => {
  const server = serve(answers);
  return resolveDirectoryConnect({ row, signIn, library }).pipe(
    Effect.provideService(HttpClient.HttpClient, server.client),
    Effect.map((step) => ({ step, requested: server.requested })),
  );
};

describe("resolveDirectoryConnect", () => {
  it.effect("falls back to the next route when one does not answer", () =>
    Effect.gen(function* () {
      const { step, requested } = yield* resolve(
        { [TAILNET]: () => Response.json(identity(BOOK)) },
        signedInLibrary,
      );
      expect(requested).toEqual([PUBLIC, TAILNET]);
      expect(step).toEqual({
        kind: "sign-in",
        surface: "native",
        environmentId: BOOK,
        route: { kind: "tailnet", url: TAILNET },
        request: {
          httpBaseUrl: TAILNET,
          expectedEnvironmentId: BOOK,
          expectedIssuer: LIBRARY_ISSUER,
          expectedIdentity: ACCOUNT,
        },
        issuer: LIBRARY_ISSUER,
      });
    }),
  );

  it.effect("pairs at the first route when no route answers", () =>
    Effect.gen(function* () {
      const { step } = yield* resolve({}, signedInLibrary);
      expect(step).toMatchObject({ kind: "pairing", httpBaseUrl: PUBLIC, reason: "unreachable" });
    }),
  );

  it.effect("skips a route that reaches another computer", () =>
    Effect.gen(function* () {
      const reroutes = yield* resolve(
        {
          [PUBLIC]: () => Response.json(identity(STUDIO)),
          [TAILNET]: () => Response.json(identity(BOOK)),
        },
        signedInLibrary,
      );
      expect(reroutes.step).toMatchObject({ kind: "sign-in", route: { url: TAILNET } });

      // Pairing never prefills an address that answered as another computer: the code would go there.
      const elsewhere = yield* resolve(
        { [PUBLIC]: () => Response.json(identity(STUDIO)) },
        signedInLibrary,
      );
      expect(elsewhere.step).toMatchObject({
        kind: "pairing",
        environmentId: BOOK,
        httpBaseUrl: TAILNET,
        reason: "unreachable",
      });

      const nowhere = yield* resolve(
        {
          [PUBLIC]: () => Response.json(identity(STUDIO)),
          [TAILNET]: () => Response.json(identity(STUDIO)),
        },
        signedInLibrary,
      );
      expect(nowhere.step).toEqual({
        kind: "pairing",
        environmentId: BOOK,
        httpBaseUrl: null,
        reason: "other-computer",
        reasonText: "The address Loom has for this computer reaches a different one.",
      });
    }),
  );

  it.effect("pairs, with the reason, when the computer names another issuer", () =>
    Effect.gen(function* () {
      const { step } = yield* resolve(
        {
          [PUBLIC]: () => Response.json(identity(BOOK, { issuer: "https://id.attacker.example" })),
        },
        signedInLibrary,
      );
      expect(step).toEqual({
        kind: "pairing",
        environmentId: BOOK,
        httpBaseUrl: PUBLIC,
        reason: "issuer-mismatch",
        reasonText: "This computer uses a different sign-in provider than your Library.",
      });
    }),
  );

  it.effect("reads the issuer from the Library when this device paired with it", () =>
    Effect.gen(function* () {
      const { step, requested } = yield* resolve(
        {
          [PUBLIC]: () => Response.json(identity(BOOK)),
          [LIBRARY_URL]: () => Response.json(identity(LIBRARY)),
        },
        pairedLibrary,
      );
      expect(requested).toEqual([PUBLIC, LIBRARY_URL]);
      // No account to pin, but the sign-in still refuses another provider before it opens.
      expect(step).toMatchObject({ kind: "sign-in", issuer: LIBRARY_ISSUER });
      expect(step?.kind === "sign-in" ? step.request : null).toEqual({
        httpBaseUrl: PUBLIC,
        expectedEnvironmentId: BOOK,
        expectedIssuer: LIBRARY_ISSUER,
      });
    }),
  );

  it.effect("pairs when the Library's issuer is unknown", () =>
    Effect.gen(function* () {
      const book = { [PUBLIC]: () => Response.json(identity(BOOK)) };
      for (const library of [
        {},
        { [LIBRARY_URL]: () => new Response(null, { status: 404 }) },
        { [LIBRARY_URL]: () => Response.json(identity(LIBRARY, { enabled: false })) },
        // Metadata from another environment is not the Library's.
        { [LIBRARY_URL]: () => Response.json(identity(STUDIO)) },
      ]) {
        const { step } = yield* resolve({ ...book, ...library }, pairedLibrary);
        expect(step).toMatchObject({ kind: "pairing", reason: "library-issuer-unknown" });
      }
    }),
  );

  it.effect("signs a native app in at the public route first", () =>
    Effect.gen(function* () {
      const both = {
        [PUBLIC]: () => Response.json(identity(BOOK)),
        [TAILNET]: () => Response.json(identity(BOOK)),
      };
      const { step, requested } = yield* resolve(both, signedInLibrary);
      expect(requested).toEqual([PUBLIC]);
      expect(step).toMatchObject({ kind: "sign-in", surface: "native", route: { url: PUBLIC } });
    }),
  );

  it.effect("signs a browser in over tailnet without reading the public route", () =>
    Effect.gen(function* () {
      const both = {
        [PUBLIC]: () => Response.json(identity(BOOK)),
        [TAILNET]: () => Response.json(identity(BOOK)),
      };
      const { step, requested } = yield* resolve(both, signedInLibrary, bookRow, browser);
      expect(requested).toEqual([TAILNET]);
      expect(step).toMatchObject({
        kind: "sign-in",
        surface: "browser",
        route: { url: TAILNET },
        request: { httpBaseUrl: TAILNET },
      });
    }),
  );

  it.effect("pairs a browser when only the public reach address answers", () =>
    Effect.gen(function* () {
      const { step, requested } = yield* resolve(
        { [PUBLIC]: () => Response.json(identity(BOOK)) },
        signedInLibrary,
        bookRow,
        browser,
      );
      expect(requested).toEqual([TAILNET, PUBLIC]);
      expect(step).toEqual({
        kind: "pairing",
        environmentId: BOOK,
        httpBaseUrl: PUBLIC,
        reason: "reach-browser",
        reasonText: "Sign in from this browser on your home network, or pair it with a code.",
      });
    }),
  );

  it.effect("signs in before and after a computer adopts its own resource, never another's", () =>
    Effect.gen(function* () {
      const library = "https://library.example.com/computers";
      for (const resource of [undefined, `${library}/book`]) {
        const { step } = yield* resolve(
          {
            [PUBLIC]: () =>
              Response.json(identity(BOOK, resource === undefined ? {} : { resource })),
          },
          signedInLibrary,
        );
        expect(step).toMatchObject({ kind: "sign-in", request: { httpBaseUrl: PUBLIC } });
      }
      const other = yield* resolve(
        { [PUBLIC]: () => Response.json(identity(BOOK, { resource: `${library}/desk` })) },
        signedInLibrary,
      );
      expect(other.step).toMatchObject({ kind: "pairing", reason: "resource-mismatch" });
    }),
  );

  it.effect("pairs with a computer that has no Loom sign-in", () =>
    Effect.gen(function* () {
      const { step } = yield* resolve(
        { [PUBLIC]: () => new Response(null, { status: 404 }) },
        signedInLibrary,
      );
      expect(step).toMatchObject({ kind: "pairing", httpBaseUrl: PUBLIC, reason: "no-sign-in" });
    }),
  );
});

describe("directoryLibraryTrust", () => {
  it("takes the account this device signed in to the Library with", () => {
    const connectionId = "bearer:library";
    const trust = directoryLibraryTrust({
      target: new BearerConnectionTarget({
        environmentId: LIBRARY,
        label: "Library",
        connectionId,
      }),
      profile: Option.some(
        new BearerConnectionProfile({
          connectionId,
          environmentId: LIBRARY,
          label: "Library",
          httpBaseUrl: LIBRARY_URL,
          wsBaseUrl: "wss://library.example.com/ws",
          identity: ACCOUNT,
        }),
      ),
      enabled: true,
    });
    expect(trust).toEqual(signedInLibrary);
  });
});

describe("savedIdentitySignIn", () => {
  const route = (url: string, options: { learned?: true; identity?: boolean } = {}) => {
    const connectionId = `bearer:${url}`;
    return {
      target: new BearerConnectionTarget({ environmentId: BOOK, label: "Book", connectionId }),
      profile: Option.some(
        new BearerConnectionProfile({
          connectionId,
          environmentId: BOOK,
          label: "Book",
          httpBaseUrl: `${url}/`,
          wsBaseUrl: `${url.replace("https:", "wss:")}/`,
          ...(options.identity === false ? {} : { identity: ACCOUNT }),
          ...(options.learned ? { learned: true as const } : {}),
        }),
      ),
    } satisfies ConnectionRoute;
  };
  const entry = (routes: readonly [ConnectionRoute, ...ConnectionRoute[]]) => {
    const [first, ...rest] = routes;
    return {
      target: first.target,
      profile: first.profile,
      enabled: true,
      ...(rest.length === 0 ? {} : { alternateRoutes: rest }),
    };
  };

  it("pins the saved account and computer at the first route that signed in", () => {
    const saved = entry([route(TAILNET), route(PUBLIC, { learned: true })]);
    expect(savedIdentitySignIn(saved, "browser")).toEqual({
      httpBaseUrl: `${TAILNET}/`,
      expectedEnvironmentId: BOOK,
      expectedIdentity: ACCOUNT,
    });
  });

  it("never sends a browser to a learned public route", () => {
    const reachFirst = entry([route(PUBLIC, { learned: true }), route(TAILNET, { learned: true })]);
    expect(savedIdentitySignIn(reachFirst, "browser")?.httpBaseUrl).toBe(`${TAILNET}/`);
    expect(savedIdentitySignIn(reachFirst, "native")?.httpBaseUrl).toBe(`${PUBLIC}/`);

    const reachOnly = entry([
      route(TAILNET, { identity: false }),
      route(PUBLIC, { learned: true }),
    ]);
    expect(savedIdentitySignIn(reachOnly, "browser")).toBeNull();
    // A public address the user saved is theirs to use.
    expect(savedIdentitySignIn(entry([route(PUBLIC)]), "browser")?.httpBaseUrl).toBe(`${PUBLIC}/`);
  });

  it("pins the account on routes learned later too", () => {
    const signedIn = route(TAILNET);
    const learned = mergeLearnedRoutes({
      entry: entry([signedIn]),
      activeRoute: signedIn,
      reported: [
        { kind: "tailnet", httpBaseUrl: TAILNET },
        { kind: "public", httpBaseUrl: PUBLIC },
      ],
      allowInsecure: false,
    });
    const reach = learned?.find((candidate) =>
      Option.exists(
        candidate.profile,
        (profile) => profile._tag === "BearerConnectionProfile" && profile.learned === true,
      ),
    );
    expect(reach).toBeDefined();
    expect(savedIdentitySignIn(entry([reach!]), "native")).toEqual({
      httpBaseUrl: `${PUBLIC}/`,
      expectedEnvironmentId: BOOK,
      expectedIdentity: ACCOUNT,
    });
  });
});

describe("directorySignInMismatch", () => {
  const step: Extract<DirectoryConnectStep, { kind: "sign-in" }> = {
    kind: "sign-in",
    surface: "native",
    environmentId: BOOK,
    route: { kind: "public", url: PUBLIC },
    request: {
      httpBaseUrl: PUBLIC,
      expectedEnvironmentId: BOOK,
      expectedIssuer: LIBRARY_ISSUER,
      expectedIdentity: ACCOUNT,
    },
    issuer: LIBRARY_ISSUER,
  };

  it("accepts the planned computer's session from the Library's issuer and account", () => {
    expect(directorySignInMismatch(step, { environmentId: BOOK, identity: ACCOUNT })).toBeNull();
  });

  it("refuses a session that changed issuer, account or computer after the plan", () => {
    for (const result of [
      { environmentId: BOOK, identity: { ...ACCOUNT, issuer: "https://id.attacker.example" } },
      { environmentId: BOOK, identity: { ...ACCOUNT, subject: "someone-else" } },
      { environmentId: BOOK },
      { environmentId: STUDIO, identity: ACCOUNT },
    ]) {
      expect(directorySignInMismatch(step, result)).not.toBeNull();
    }
  });
});
