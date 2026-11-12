import { ExecutionEnvironmentDescriptor, EnvironmentId } from "@t3tools/contracts";
import {
  ACCOUNT_JOIN_BEGIN,
  ACCOUNT_JOIN_REDEEM,
  ACCOUNT_JOIN_FEATURE,
  AccountJoinRequest,
  AccountJoinReview,
  AccountJoinRedemption,
  ComputerJoinStart,
  ComputerJoinPrompt,
  ComputerJoinProgress,
  LibraryError,
  LibraryInfo,
} from "@t3tools/contracts/fork";
import { decodeEd25519PublicKey, keyFingerprint } from "@t3tools/shared/fork/directory";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { ServerConfig } from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { writeLibraryCredential } from "../project-library/enrollment.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
import { AccountEnrollment } from "./AccountEnrollment.ts";

const State = Schema.Struct({
  version: Schema.Literal(1),
  sourceEnvironmentId: EnvironmentId,
  libraryEnvironmentId: EnvironmentId,
  libraryUrl: Schema.String,
  requestId: Schema.String,
  secret: AccountJoinRequest.fields.secret,
  expiresAt: Schema.Number,
  review: Schema.NullOr(AccountJoinReview),
  complete: Schema.Boolean,
});
type State = typeof State.Type;
const encodeState = Schema.encodeEffect(Schema.fromJsonString(State));
const decodeState = Schema.decodeEffect(Schema.fromJsonString(State));
const encodeRequest = Schema.encodeEffect(AccountJoinRequest);
const decodeDescriptor = Schema.decodeUnknownEffect(ExecutionEnvironmentDescriptor);
const decodeReview = Schema.decodeUnknownEffect(AccountJoinReview);
const decodeInfo = Schema.decodeUnknownEffect(LibraryInfo);
const decodeRedemption = Schema.decodeUnknownEffect(AccountJoinRedemption);
const unavailable = () =>
  new LibraryError({
    reason: "io",
    detail: "Computer setup could not finish. Run the same join command to resume.",
  });
const refused = () =>
  new LibraryError({
    reason: "blocked",
    detail:
      "This join request does not match the computer and Library. Check the account address before starting again.",
  });
const validUrl = (value: string) =>
  Effect.try({
    try: () => {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw new Error("Invalid account address");
      return url.origin;
    },
    catch: refused,
  });

export class ComputerJoin extends Context.Service<
  ComputerJoin,
  {
    readonly start: (
      input: typeof ComputerJoinStart.Type,
    ) => Effect.Effect<typeof ComputerJoinPrompt.Type, LibraryError>;
    readonly step: Effect.Effect<typeof ComputerJoinProgress.Type, LibraryError>;
  }
>()("t3/fork/account-access/ComputerJoin") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const identity = yield* ServerEnvironmentIdentity;
  const enrollment = yield* AccountEnrollment;
  const connection = yield* LibraryConnectionService;
  const http = yield* HttpClient.HttpClient;
  const random = yield* SecureRandom.SecureRandom;
  const lock = yield* Semaphore.make(1);
  const file = path.join(config.secretsDir, "computer-join.json");
  const save = Effect.fn("ComputerJoin.save")(function* (state: State) {
    yield* writeLibraryCredential({
      file,
      contents: yield* encodeState(state),
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );
  }, Effect.mapError(unavailable));
  const load = Effect.fn("ComputerJoin.load")(function* () {
    if (!(yield* fs.exists(file).pipe(Effect.mapError(unavailable)))) return null;
    const stat = yield* fs.stat(file).pipe(Effect.mapError(unavailable));
    if (stat.type !== "File" || Number(stat.size) > 16384 || (stat.mode & 0o077) !== 0)
      return yield* unavailable();
    const state = yield* fs
      .readFileString(file)
      .pipe(Effect.flatMap(decodeState), Effect.mapError(unavailable));
    if (state.sourceEnvironmentId !== (yield* identity.getEnvironmentId)) return yield* refused();
    return state;
  });
  const execute = (request: HttpClientRequest.HttpClientRequest) =>
    http
      .execute(request)
      .pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.timeout("20 seconds"),
        Effect.mapError(unavailable),
      );
  const requestFor = Effect.fn("ComputerJoin.requestFor")(function* (state: State) {
    return {
      proof: yield* enrollment.prepare({
        requestId: state.requestId,
        libraryUrl: state.libraryUrl,
        libraryEnvironmentId: state.libraryEnvironmentId,
      }),
      secret: state.secret,
    };
  });
  const enrollmentActive = Effect.fn("ComputerJoin.enrollmentActive")(function* (state: State) {
    const current = yield* connection.current;
    if (
      current.kind !== "remote" ||
      current.credential?.libraryEnvironmentId !== state.libraryEnvironmentId ||
      current.origin !== state.libraryUrl
    )
      return false;
    const response = yield* connection
      .send(HttpClientRequest.get("/api/loom/library/info"))
      .pipe(Effect.timeout("20 seconds"), Effect.mapError(unavailable));
    if (response.status === 401 || response.status === 403) return false;
    if (response.status !== 200) return yield* unavailable();
    const info = yield* response.json.pipe(
      Effect.flatMap(decodeInfo),
      Effect.mapError(unavailable),
    );
    if (!info.isAuthority || info.environmentId !== state.libraryEnvironmentId)
      return yield* refused();
    return true;
  });
  const start = Effect.fn("ComputerJoin.start")(function* (input: typeof ComputerJoinStart.Type) {
    const libraryUrl = yield* validUrl(input.libraryUrl);
    let previous = yield* load();
    if (previous !== null && previous.libraryUrl !== libraryUrl) return yield* refused();
    if (previous?.complete && previous.review !== null && !input.restart) {
      if (yield* enrollmentActive(previous)) return { libraryUrl, review: previous.review };
      previous = null;
    }
    const response = yield* execute(
      HttpClientRequest.get(`${libraryUrl}/.well-known/t3/environment`),
    );
    if (response.status !== 200) return yield* unavailable();
    const descriptor = yield* response.json.pipe(
      Effect.flatMap(decodeDescriptor),
      Effect.mapError(refused),
    );
    if (
      descriptor.capabilities.libraryAuthority !== true ||
      !descriptor.capabilities.loomFeatures?.includes(ACCOUNT_JOIN_FEATURE)
    )
      return yield* new LibraryError({
        reason: "blocked",
        detail: "Update your Library to support computer approval from a terminal.",
      });
    const now = yield* Clock.currentTimeMillis;
    const state: State =
      previous !== null && previous.expiresAt > now && !input.restart
        ? previous
        : {
            version: 1,
            sourceEnvironmentId: yield* identity.getEnvironmentId,
            libraryEnvironmentId: descriptor.environmentId,
            libraryUrl,
            requestId: Hex.encode(yield* random.randomBytes(32).pipe(Effect.mapError(unavailable))),
            secret: Redacted.make(
              Hex.encode(yield* random.randomBytes(32).pipe(Effect.mapError(unavailable))),
            ),
            expiresAt: now + 15 * 60_000,
            review: null,
            complete: false,
          };
    if (state.libraryEnvironmentId !== descriptor.environmentId) return yield* refused();
    const request = yield* requestFor(state);
    yield* save(state);
    const begin = yield* execute(
      HttpClientRequest.post(`${libraryUrl}${ACCOUNT_JOIN_BEGIN}`).pipe(
        HttpClientRequest.bodyJsonUnsafe(
          yield* encodeRequest(request).pipe(Effect.mapError(refused)),
        ),
      ),
    );
    if (begin.status !== 200) return yield* unavailable();
    const review = yield* begin.json.pipe(Effect.flatMap(decodeReview), Effect.mapError(refused));
    const key = decodeEd25519PublicKey(request.proof.request.publicKey);
    if (
      review.requestId !== state.requestId ||
      review.environmentId !== state.sourceEnvironmentId ||
      key === null ||
      review.keyFingerprint !== keyFingerprint(key)
    )
      return yield* refused();
    yield* save({ ...state, review, expiresAt: review.expiresAt });
    return { libraryUrl, review };
  }, lock.withPermit);
  const step = Effect.gen(function* () {
    const state = yield* load();
    if (state === null) return yield* refused();
    if (state.complete) {
      if (yield* enrollmentActive(state)) return "complete" as const;
      return yield* new LibraryError({
        reason: "request-conflict",
        detail:
          "This computer’s account access has ended. Run the join command again for a new approval code.",
      });
    }
    if (state.expiresAt <= (yield* Clock.currentTimeMillis))
      return yield* new LibraryError({
        reason: "request-conflict",
        detail: "This computer approval has expired. Run the join command again for a new code.",
      });
    const request = yield* requestFor(state);
    const response = yield* execute(
      HttpClientRequest.post(`${state.libraryUrl}${ACCOUNT_JOIN_REDEEM}`).pipe(
        HttpClientRequest.bodyJsonUnsafe(
          yield* encodeRequest(request).pipe(Effect.mapError(refused)),
        ),
      ),
    );
    if (response.status !== 200) return yield* unavailable();
    const result = yield* response.json.pipe(
      Effect.flatMap(decodeRedemption),
      Effect.mapError(refused),
    );
    if (result.state !== "approved") return result.state;
    yield* enrollment.install(result.enrollment);
    yield* save({ ...state, complete: true });
    return "complete" as const;
  }).pipe(lock.withPermit, Effect.withSpan("ComputerJoin.step"));
  return ComputerJoin.of({ start, step });
});
export const layer = Layer.effect(ComputerJoin, make);
