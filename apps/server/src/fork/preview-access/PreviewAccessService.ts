import {
  AuthOrchestrationOperateScope,
  type AuthSessionId,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  LOOM_IDENTITY_LOGIN_PATH,
  LibraryError,
  parsePreviewLinkHost,
  type LibraryPreviewAccess,
  type LibraryPreviewRegisterRequest,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { AuthSessionRepository } from "../../persistence/AuthSessions.ts";
import { sanitizeEntryPath } from "../preview-links/policy.ts";
import {
  PREVIEW_TICKET_PATH,
  generatePreviewTicketKeyPair,
  isPreviewNonce,
  previewTicketAudience,
  previewTicketKeyId,
  previewTicketPrivateKey,
  previewTicketPublicKey,
  signPreviewTicket,
  verifyPreviewTicket,
  type VerifiedPreviewTicket,
} from "../preview-links/ticket.ts";
import { makeStore, type PreviewHostRow } from "./store.ts";

/** Where a computer sends a cold browser; served by the Library on its public origin. */
export const PREVIEW_TICKET_ROUTE = "/api/loom/preview/ticket";
/** The subject of a computer's own Library publisher session, and the key of its hosts. */
export const COMPUTER_SUBJECT_PREFIX = "loom-host:";
/** Its own key: tickets must never verify under the cloud-link or any other signing key. */
const TICKET_KEY_SECRET = "loom-preview-ticket-ed25519";
/** PocketId drops a longer `returnTo` and would land the browser on `/` instead of back here. */
const MAX_RETURN_TO_LENGTH = 2048;
const HOST_PATTERN = /^[a-z0-9.-]{1,253}$/;

const StoredKeyPair = Schema.fromJsonString(
  Schema.Struct({ privateKey: Schema.String, publicKey: Schema.String }),
);
const decodeKeyPair = Schema.decodeUnknownEffect(StoredKeyPair);
const encodeKeyPair = Schema.encodeEffect(StoredKeyPair);

type TicketKey = {
  readonly privateKey: NonNullable<ReturnType<typeof previewTicketPrivateKey>>;
  readonly publicKey: string;
  /** `publicKey` as a key object, for tickets that come back to this Library's own pages host. */
  readonly verifier: NonNullable<ReturnType<typeof previewTicketPublicKey>>;
  readonly keyId: string;
};

export interface PreviewRegisterInput {
  readonly environmentId: EnvironmentId;
  /**
   * The Library session the computer registered with. Its hosts get tickets only while that
   * session lasts, so revoking the session takes the computer out. Null when this Library
   * registers its own computer in-process, which cannot leave itself.
   */
  readonly sessionId: AuthSessionId | null;
  readonly previews: LibraryPreviewRegisterRequest["previews"];
}

/** Raw query values; the service validates every one of them. */
export interface PreviewTicketInput {
  readonly host: string | null;
  readonly nonce: string | null;
  readonly path: string | null;
  readonly session: Pick<AuthenticatedSession, "subject" | "scopes"> | null;
}

/** A ticket that came back to a host this Library serves itself. */
export interface PreviewVerifyTicketInput {
  readonly token: string;
  /** Already normalized; the ticket's audience must name exactly this host. */
  readonly host: string;
  /** From the browser's nonce cookie. */
  readonly nonce: string;
}

export type PreviewTicketOutcome =
  /** The browser has no Library session yet; send it through sign-in and back. */
  | { readonly _tag: "SignIn"; readonly location: string }
  /** A signed ticket on its way to the preview host. */
  | { readonly _tag: "Ticket"; readonly location: string };

export class PreviewAccessService extends Context.Service<
  PreviewAccessService,
  {
    /** Records (or with null, forgets) the preview hosts a computer serves. Library only. */
    readonly register: (
      input: PreviewRegisterInput,
    ) => Effect.Effect<LibraryPreviewAccess, LibraryError>;
    /** Signs a one-host, one-nonce ticket for a signed-in operator. Library only. */
    readonly ticket: (
      input: PreviewTicketInput,
    ) => Effect.Effect<PreviewTicketOutcome, LibraryError>;
    /**
     * The `iss` every ticket carries, or null when this server is not the authority or has no
     * configured public origin. Without one it registers no hosts and signs no tickets.
     */
    readonly issuerOrigin: string | null;
    /** Checks a ticket this Library signed. Null on any mismatch, never a failure for bad input. */
    readonly verifyTicket: (
      input: PreviewVerifyTicketInput,
    ) => Effect.Effect<VerifiedPreviewTicket | null, LibraryError>;
  }
>()("t3/fork/preview-access/PreviewAccessService") {}

const httpsUrl = (value: string): URL | null => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

const make = Effect.gen(function* () {
  const authority = yield* Config.Boolean("LOOM_LIBRARY_AUTHORITY").pipe(Config.withDefault(false));
  // The identity callback is where the browser's Library session cookie lives, so it names the
  // public origin that issues tickets even when computers reach the Library some other way.
  const identityRedirect = yield* Config.String("LOOM_IDENTITY_REDIRECT_URI").pipe(Config.option);
  const pagesSetting = yield* Config.String("LOOM_PAGES_ORIGIN").pipe(Config.option);
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const sessions = yield* AuthSessionRepository;
  const ownEnvironmentId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  const store = yield* makeStore;
  // Spent pages tickets are memory only, so tickets signed before this run are never accepted.
  const startedAtMs = yield* Clock.currentTimeMillis;

  // Pocket ID accepts a callback on any https port, so the issuer keeps the port too.
  const configuredOrigin = Option.isSome(identityRedirect)
    ? (httpsUrl(identityRedirect.value.trim())?.origin ?? null)
    : null;
  const issuerOrigin = authority ? configuredOrigin : null;
  // A request's origin only says how that caller reached the Library, which browsers may not
  // share, so it never stands in for the public origin.
  if (authority && issuerOrigin === null)
    yield* Effect.logWarning(
      "Preview sign-in is off: LOOM_IDENTITY_REDIRECT_URI must name the Library's public https origin, which signs preview sign-ins.",
    );
  // Tickets land on `https://<host>/__loom/ticket`, which has no room for a port.
  const pagesCandidate = Option.isSome(pagesSetting) ? httpsUrl(pagesSetting.value.trim()) : null;
  const pagesUrl = pagesCandidate?.port === "" ? pagesCandidate : null;
  if (Option.isSome(pagesSetting) && pagesSetting.value.trim() !== "" && pagesUrl === null)
    yield* Effect.logWarning(
      "LOOM_PAGES_ORIGIN is not an https origin without a port; ignoring it.",
    );
  const pagesHost = pagesUrl?.hostname.toLowerCase() ?? null;

  const io = (cause: unknown) => new LibraryError({ reason: "io", cause });
  const requireIssuer =
    issuerOrigin === null
      ? Effect.fail(new LibraryError({ reason: "not-authority" }))
      : Effect.succeed(issuerOrigin);

  const keyRef = yield* Ref.make<TicketKey | null>(null);
  const keyLock = yield* Semaphore.make(1);
  const toTicketKey = (stored: { readonly privateKey: string; readonly publicKey: string }) => {
    const privateKey = previewTicketPrivateKey(stored.privateKey);
    const verifier = previewTicketPublicKey(stored.publicKey);
    // Replacing an unreadable key would silently break every computer's cached public key.
    if (privateKey === null || verifier === null)
      return Effect.fail(io("The stored preview ticket key is unreadable."));
    return Effect.succeed<TicketKey>({
      privateKey,
      publicKey: stored.publicKey,
      verifier,
      keyId: previewTicketKeyId(stored.publicKey),
    });
  };
  const readKey = secrets.get(TICKET_KEY_SECRET).pipe(
    Effect.mapError(io),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(Option.none<TicketKey>()),
        onSome: (bytes) =>
          decodeKeyPair(new TextDecoder().decode(bytes)).pipe(
            Effect.mapError(io),
            Effect.flatMap(toTicketKey),
            // It never heals by itself, and browsers only see "try again", so say it here.
            Effect.tapError(() =>
              Effect.logError(
                `The stored ${TICKET_KEY_SECRET} secret is unreadable; preview sign-in is off until it is removed.`,
              ),
            ),
            Effect.asSome,
          ),
      }),
    ),
  );
  const createKey = Effect.gen(function* () {
    const pair = generatePreviewTicketKeyPair();
    const encoded = yield* encodeKeyPair(pair).pipe(Effect.mapError(io));
    const created = yield* secrets
      .create(TICKET_KEY_SECRET, new TextEncoder().encode(encoded))
      .pipe(
        Effect.as(true),
        Effect.catchIf(ServerSecretStore.isSecretAlreadyExistsError, () => Effect.succeed(false)),
        Effect.mapError(io),
      );
    if (created) return yield* toTicketKey(pair);
    // Another request created it first; use theirs so only one key is ever published.
    const theirs = yield* readKey;
    if (Option.isNone(theirs)) return yield* io("The preview ticket key vanished while saving.");
    return theirs.value;
  });
  // Serialized so concurrent first tickets cannot each create a key.
  const ticketKey = keyLock.withPermit(
    Effect.gen(function* () {
      const cached = yield* Ref.get(keyRef);
      if (cached !== null) return cached;
      const existing = yield* readKey;
      const key = Option.isSome(existing) ? existing.value : yield* createKey;
      yield* Ref.set(keyRef, key);
      return key;
    }),
  );

  const register: PreviewAccessService["Service"]["register"] = Effect.fn(
    "PreviewAccessService.register",
  )(function* (input: PreviewRegisterInput) {
    const origin = yield* requireIssuer;
    const key = yield* ticketKey;
    const subject = `${COMPUTER_SUBJECT_PREFIX}${input.environmentId}`;
    if (input.previews === null) yield* store.remove(subject).pipe(Effect.mapError(io));
    else {
      const updatedAt = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
      yield* store
        .put(
          {
            subject,
            environmentId: input.environmentId,
            sessionId: input.sessionId,
            machine: input.previews.machine,
            suffix: input.previews.suffix.toLowerCase(),
          },
          updatedAt,
        )
        .pipe(Effect.mapError(io));
    }
    return {
      origin,
      ticketPath: PREVIEW_TICKET_ROUTE,
      keyId: key.keyId,
      publicKey: key.publicKey,
      ...(pagesUrl === null ? {} : { pagesOrigin: pagesUrl.origin }),
    } satisfies LibraryPreviewAccess;
  });

  const stillEnrolled = (row: PreviewHostRow, nowMs: number) =>
    row.sessionId === null
      ? // Only this Library's own computer registers without a session. Any other session-less
        // row, such as one an older build wrote after a downgrade, has nothing to retire it.
        Effect.succeed(row.environmentId === ownEnvironmentId)
      : sessions
          .getById({ sessionId: row.sessionId })
          .pipe(
            Effect.mapError(io),
            Effect.map(
              Option.exists(
                (session) =>
                  session.revokedAt === null && DateTime.toEpochMillis(session.expiresAt) > nowMs,
              ),
            ),
          );

  const knownHost = Effect.fn("PreviewAccessService.knownHost")(function* (host: string) {
    if (pagesHost !== null && host === pagesHost) return true;
    const nowMs = yield* Clock.currentTimeMillis;
    for (const row of yield* store.list().pipe(Effect.mapError(io))) {
      if (parsePreviewLinkHost(host, row.suffix)?.machine !== row.machine) continue;
      if (yield* stillEnrolled(row, nowMs)) return true;
      // Its computer left the Library, so its hosts go now rather than at a registration.
      yield* store.forget(row).pipe(Effect.mapError(io));
    }
    return false;
  });

  const ticket: PreviewAccessService["Service"]["ticket"] = Effect.fn(
    "PreviewAccessService.ticket",
  )(function* (input: PreviewTicketInput) {
    const origin = yield* requireIssuer;
    const host = input.host?.toLowerCase() ?? "";
    if (!HOST_PATTERN.test(host) || !isPreviewNonce(input.nonce))
      return yield* new LibraryError({ reason: "invalid" });
    const nonce = input.nonce;
    const path = sanitizeEntryPath(input.path ?? undefined);
    if (input.session === null) {
      const back = (landing: string) =>
        `${PREVIEW_TICKET_ROUTE}?${new URLSearchParams({ host, nonce, path: landing })}`;
      const returnTo = back(path).length <= MAX_RETURN_TO_LENGTH ? back(path) : back("/");
      return {
        _tag: "SignIn",
        location: `${LOOM_IDENTITY_LOGIN_PATH}?${new URLSearchParams({ returnTo })}`,
      } as const;
    }
    // A ticket opens a computer's preview as this person, so it takes the right to run work.
    if (
      input.session.subject === "mcp-client" ||
      !input.session.scopes.includes(AuthOrchestrationOperateScope)
    )
      return yield* new LibraryError({ reason: "blocked" });
    // Checked after sign-in so a signed-out browser learns nothing about which computers exist.
    if (!(yield* knownHost(host))) return yield* new LibraryError({ reason: "not-found" });
    const key = yield* ticketKey;
    const signed = signPreviewTicket({
      privateKey: key.privateKey,
      keyId: key.keyId,
      issuer: origin,
      audience: previewTicketAudience(host),
      subject: input.session.subject,
      nonce,
      nowMs: yield* Clock.currentTimeMillis,
    });
    return {
      _tag: "Ticket",
      location: `https://${host}${PREVIEW_TICKET_PATH}?${new URLSearchParams({ ticket: signed, path })}`,
    } as const;
  });

  const verifyTicket: PreviewAccessService["Service"]["verifyTicket"] = Effect.fn(
    "PreviewAccessService.verifyTicket",
  )(function* (input: PreviewVerifyTicketInput) {
    if (issuerOrigin === null || !isPreviewNonce(input.nonce)) return null;
    const key = yield* ticketKey;
    return verifyPreviewTicket(input.token, {
      publicKey: key.verifier,
      keyId: key.keyId,
      issuer: issuerOrigin,
      audience: previewTicketAudience(input.host),
      nonce: input.nonce,
      nowMs: yield* Clock.currentTimeMillis,
      notBeforeMs: startedAtMs,
    });
  });

  return PreviewAccessService.of({ register, ticket, issuerOrigin, verifyTicket });
});

export const layer = Layer.effect(PreviewAccessService, make);
