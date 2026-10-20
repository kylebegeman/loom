import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { randomPreviewNonce } from "../preview-links/ticket.ts";
import { PreviewAccessMigrations } from "./migrations.ts";
import * as PreviewAccess from "./PreviewAccessService.ts";

const LIBRARY_ORIGIN = "https://library.example.test";
const PAGES_HOST = "pages.example.test";
const AUTHORITY_ENV = {
  LOOM_LIBRARY_AUTHORITY: "true",
  LOOM_IDENTITY_REDIRECT_URI: `${LIBRARY_ORIGIN}/api/loom/identity/callback`,
  LOOM_PAGES_ORIGIN: `https://${PAGES_HOST}`,
};
const OPERATOR = {
  subject: "owner",
  scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
};

const withService = <A, E>(
  env: Record<string, string>,
  use: (service: PreviewAccess.PreviewAccessService["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(PreviewAccessMigrations);
    const secretValues = new Map<string, Uint8Array>();
    const secrets = ServerSecretStore.of({
      get: (name) => Effect.sync(() => Option.fromNullishOr(secretValues.get(name))),
      set: (name, value) => Effect.sync(() => void secretValues.set(name, value)),
      create: (name, value) => Effect.sync(() => void secretValues.set(name, value)),
      getOrCreateRandom: (_name, bytes) => Effect.succeed(new Uint8Array(bytes)),
      remove: (name) => Effect.sync(() => void secretValues.delete(name)),
    });
    const service = yield* PreviewAccess.PreviewAccessService.pipe(
      Effect.provide(
        PreviewAccess.layer.pipe(
          Layer.provide(Layer.succeed(ServerSecretStore, secrets)),
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        ),
      ),
    );
    return yield* use(service);
  }).pipe(
    Effect.provide(SqlitePersistenceMemory.pipe(Layer.provideMerge(NodeServices.layer))),
    Effect.scoped,
  );

/** A ticket the Library signs for its own pages host, as the browser carries it there. */
const pagesTicket = (
  service: PreviewAccess.PreviewAccessService["Service"],
  nonce: string,
  requestOrigin = "https://computer-route.test",
) =>
  service
    .ticket({
      host: PAGES_HOST,
      nonce,
      path: "/p/AbCdEfGhIjKlMnOpQrStUv",
      session: OPERATOR,
      requestOrigin,
    })
    .pipe(
      Effect.map((outcome) => {
        expect(outcome._tag).toBe("Ticket");
        const token = new URL(outcome.location).searchParams.get("ticket");
        if (token === null) throw new Error("The ticket redirect carries no ticket.");
        return token;
      }),
    );

describe("PreviewAccessService pages tickets", () => {
  it.effect("names the configured public origin as the pages issuer", () =>
    Effect.gen(function* () {
      expect(yield* withService(AUTHORITY_ENV, (s) => Effect.succeed(s.issuerOrigin))).toBe(
        LIBRARY_ORIGIN,
      );
      const { LOOM_IDENTITY_REDIRECT_URI: _, ...withoutRedirect } = AUTHORITY_ENV;
      // Without it the ticket route signs with whatever origin a request arrived on.
      expect(yield* withService(withoutRedirect, (s) => Effect.succeed(s.issuerOrigin))).toBeNull();
      const { LOOM_LIBRARY_AUTHORITY: __, ...notAuthority } = AUTHORITY_ENV;
      expect(yield* withService(notAuthority, (s) => Effect.succeed(s.issuerOrigin))).toBeNull();
      expect(
        yield* withService(
          { ...AUTHORITY_ENV, LOOM_IDENTITY_REDIRECT_URI: "http://library.example.test/callback" },
          (s) => Effect.succeed(s.issuerOrigin),
        ),
      ).toBeNull();
    }),
  );

  it.effect("verifies a ticket it signed for its pages host", () =>
    withService(AUTHORITY_ENV, (service) =>
      Effect.gen(function* () {
        const nonce = randomPreviewNonce();
        const token = yield* pagesTicket(service, nonce);
        const verified = yield* service.verifyTicket({ token, host: PAGES_HOST, nonce });
        expect(verified).toMatchObject({ subject: "owner" });
        expect(verified?.ticketId).toMatch(/^[0-9a-f-]{36}$/);
      }),
    ),
  );

  it.effect("refuses a ticket for another nonce or host, and anything malformed", () =>
    withService(AUTHORITY_ENV, (service) =>
      Effect.gen(function* () {
        const nonce = randomPreviewNonce();
        const token = yield* pagesTicket(service, nonce);
        const verify = (input: Partial<PreviewAccess.PreviewVerifyTicketInput>) =>
          service.verifyTicket({
            token: input.token ?? token,
            host: input.host ?? PAGES_HOST,
            nonce: input.nonce ?? nonce,
          });
        expect(yield* verify({ nonce: randomPreviewNonce() })).toBeNull();
        expect(yield* verify({ host: "other.example.test" })).toBeNull();
        expect(yield* verify({ nonce: "short" })).toBeNull();
        expect(yield* verify({ token: "not.a.ticket" })).toBeNull();
      }),
    ),
  );

  it.effect("verifies nothing without a fixed issuer, even its own tickets", () => {
    const { LOOM_IDENTITY_REDIRECT_URI: _, ...withoutRedirect } = AUTHORITY_ENV;
    return withService(withoutRedirect, (service) =>
      Effect.gen(function* () {
        const nonce = randomPreviewNonce();
        // Signed with the request's origin, which the pages host has no way to expect.
        const token = yield* pagesTicket(service, nonce, LIBRARY_ORIGIN);
        expect(yield* service.verifyTicket({ token, host: PAGES_HOST, nonce })).toBeNull();
      }),
    );
  });
});
