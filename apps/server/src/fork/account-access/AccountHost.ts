import {
  AccountAdmission,
  ACCOUNT_ACCESS_VERIFY,
  AccountVerification,
} from "@t3tools/contracts/fork";
import * as Signature from "effect/crypto/Signature";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClientRequest } from "effect/http";
import * as SessionStore from "../../auth/SessionStore.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "../../cloud/environmentKeys.ts";
import {
  directoryPublicKeyFromPem,
  decodeEd25519PublicKey,
  keyFingerprint,
} from "@t3tools/shared/fork/directory";
import * as LibraryConnection from "../project-library/LibraryConnection.ts";
import { AccountAccessError } from "./AccountAccess.ts";

const decodeVerification = Schema.decodeUnknownEffect(AccountVerification);
const decodeAdmission = Schema.decodeUnknownEffect(AccountAdmission);
const encodeSessionKey = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Schema.String)));

const MAX_CACHED_SESSIONS = 256;
const SESSION_LIFETIME_MS = 24 * 60 * 60_000;

export class AccountHost extends Context.Service<
  AccountHost,
  {
    readonly admit: (
      input: Omit<typeof AccountVerification.Type, "keyFingerprint">,
    ) => Effect.Effect<string, AccountAccessError>;
  }
>()("t3/fork/account-access/AccountHost") {}

const make = Effect.gen(function* () {
  const connection = yield* LibraryConnection.LibraryConnectionService;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const sessions = yield* SessionStore.SessionStore;
  const signature = yield* Signature.Signature;
  const fingerprint = Effect.gen(function* () {
    const keyPair = yield* getOrCreateEnvironmentKeyPairFromSecretStore(secrets);
    const publicKey = directoryPublicKeyFromPem(keyPair.publicKey);
    const der = publicKey === null ? null : decodeEd25519PublicKey(publicKey);
    return der === null ? null : keyFingerprint(der);
  }).pipe(
    Effect.provideService(Signature.Signature, signature),
    Effect.mapError(() => new AccountAccessError({ reason: "unavailable" })),
  );
  const lock = yield* Semaphore.make(1);
  const cached = new Map<string, SessionStore.IssuedSession>();
  const denied = () => new AccountAccessError({ reason: "denied" });
  const admit: AccountHost["Service"]["admit"] = Effect.fn("AccountHost.admit")(function* (input) {
    const keyFingerprint = yield* fingerprint;
    if (keyFingerprint === null) return yield* denied();
    const verification = yield* decodeVerification({ ...input, keyFingerprint }).pipe(
      Effect.mapError(denied),
    );
    const library = yield* connection.current;
    // A legacy unbound Library token does not establish computer enrollment.
    if (library.kind !== "remote" || library.credential?.account === undefined)
      return yield* denied();
    const approved = library.credential.account;
    const response = yield* library
      .send(
        HttpClientRequest.post(library.endpoint(ACCOUNT_ACCESS_VERIFY)).pipe(
          HttpClientRequest.bodyJsonUnsafe(verification),
        ),
      )
      .pipe(
        Effect.timeout("10 seconds"),
        Effect.mapError(() => new AccountAccessError({ reason: "unavailable" })),
      );
    if (response.status !== 200) return yield* denied();
    const admission = yield* response.json.pipe(
      Effect.flatMap(decodeAdmission),
      Effect.mapError(denied),
    );
    const latest = yield* connection.current;
    if (
      admission.account?.authorityId !== approved.authorityId ||
      admission.account.authorityEpoch !== approved.authorityEpoch ||
      latest.kind !== "remote" ||
      latest.origin !== library.origin ||
      latest.credential?.libraryEnvironmentId !== library.credential.libraryEnvironmentId ||
      latest.credential.account?.authorityId !== approved.authorityId ||
      latest.credential.account.authorityEpoch !== approved.authorityEpoch
    )
      return yield* denied();
    const now = yield* Clock.currentTimeMillis;
    if (admission.expiresAt <= now) return yield* denied();
    return yield* lock.withPermit(
      Effect.gen(function* () {
        const key = yield* encodeSessionKey([
          library.credential!.libraryEnvironmentId,
          approved.authorityId,
          String(approved.authorityEpoch),
          admission.sessionId,
          admission.principal,
          ...admission.scopes,
        ]).pipe(Effect.orDie);
        const previous = cached.get(key);
        if (previous !== undefined && previous.expiresAt.epochMilliseconds > now + 60_000) {
          const valid = yield* sessions.verify(previous.token).pipe(Effect.result);
          if (valid._tag === "Failure") return yield* denied();
          return previous.token;
        }
        for (const [id, session] of cached)
          if (session.expiresAt.epochMilliseconds <= now) cached.delete(id);
        if (previous === undefined && cached.size >= MAX_CACHED_SESSIONS)
          return yield* new AccountAccessError({ reason: "capacity" });
        const issued = yield* sessions
          .issue({
            subject: admission.principal,
            method: "bearer-access-token",
            scopes: admission.scopes,
            expiresAt: DateTime.makeUnsafe(
              Math.min(admission.expiresAt, now + SESSION_LIFETIME_MS),
            ),
            client: { label: "Loom account device", deviceType: "unknown" },
          })
          .pipe(Effect.mapError(() => new AccountAccessError({ reason: "unavailable" })));
        cached.set(key, issued);
        if (previous !== undefined) {
          yield* sessions.linkSuccessor({
            currentToken: previous.token,
            successor: {
              ...issued,
              subject: admission.principal,
            },
          });
        }
        return issued.token;
      }),
    );
  });
  return AccountHost.of({ admit });
});

export const layer = Layer.effect(AccountHost, make);
