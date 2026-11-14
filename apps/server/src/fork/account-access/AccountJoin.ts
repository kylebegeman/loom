import { AuthEnvironmentScope, AuthSessionId, ServerAuthSessionMethod } from "@t3tools/contracts";
import {
  ACCOUNT_JOIN_APPROVAL_REQUIRED,
  ACCOUNT_JOIN_DEVICE_APPROVAL_ENDED,
  ACCOUNT_JOIN_PROMPT_CHOICES,
  AccountJoinCode,
  AccountJoinReview,
  LibraryError,
  type AccountJoinApproval,
  type AccountJoinPrompt,
  type AccountJoinRequest,
  type AccountJoinRedemption,
  type AccountJoinResponse,
} from "@t3tools/contracts/fork";
import {
  decodeEd25519PublicKey,
  keyFingerprint,
  verifyDirectoryReport,
} from "@t3tools/shared/fork/directory";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Signature from "effect/crypto/Signature";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import { PocketId, type PocketIdError } from "../../auth/PocketId.ts";
import { ServerConfig } from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { LibraryPushService } from "../library-push/LibraryPushService.ts";
import { LibraryManagement } from "../project-library/LibraryManagement.ts";
import { writeLibraryCredential } from "../project-library/enrollment.ts";
import { AccountEnrollment } from "./AccountEnrollment.ts";

const LIFETIME_MS = 15 * 60_000;
const MAX_REQUESTS = 128;
const Owner = Schema.Struct({
  sessionId: AuthSessionId,
  subject: Schema.String,
  method: ServerAuthSessionMethod,
  scopes: Schema.Array(AuthEnvironmentScope),
  expiresAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
  proofKeyThumbprint: Schema.optionalKey(Schema.String),
});
const Record = Schema.Struct({
  version: Schema.Literal(1),
  review: AccountJoinReview,
  secretHash: Schema.String,
  owner: Schema.NullOr(Owner),
  epoch: Schema.Number.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  /** Absent on requests made before owner devices were prompted; those take a typed code. */
  choices: Schema.optionalKey(Schema.Array(AccountJoinCode)),
});
type Record = typeof Record.Type;
const encode = Schema.encodeEffect(Schema.fromJsonString(Record));
const decode = Schema.decodeEffect(Schema.fromJsonString(Record));
const isCode = Schema.is(AccountJoinCode);
const unavailable = () =>
  new LibraryError({
    reason: "io",
    detail: "Computer approval could not be checked. Retry the same request.",
  });
const refused = () =>
  new LibraryError({
    reason: "blocked",
    detail:
      "This approval request does not match the computer and Library. Start joining the computer again.",
  });
const ended = () =>
  new LibraryError({
    reason: "request-conflict",
    detail:
      "This computer approval request has expired or ended. Start joining the computer again.",
  });

export class AccountJoin extends Context.Service<
  AccountJoin,
  {
    readonly begin: (input: AccountJoinRequest) => Effect.Effect<AccountJoinReview, LibraryError>;
    readonly lookup: (
      code: string,
      session: AuthenticatedSession,
    ) => Effect.Effect<AccountJoinReview, LibraryError>;
    readonly decide: (
      input: {
        readonly code: string;
        readonly approve: boolean;
        readonly approval?: AccountJoinApproval;
      },
      session: AuthenticatedSession,
    ) => Effect.Effect<AccountJoinReview, LibraryError>;
    readonly redeem: (
      input: AccountJoinRequest,
    ) => Effect.Effect<AccountJoinRedemption, LibraryError>;
    /** Pending requests for an owner device, again after every change. Never the true code. */
    readonly prompts: (
      session: AuthenticatedSession,
    ) => Stream.Stream<ReadonlyArray<AccountJoinPrompt>, LibraryError>;
    /** Approves only when `code` is the terminal's; any other answer declines the request. */
    readonly respond: (
      input: AccountJoinResponse,
      session: AuthenticatedSession,
    ) => Effect.Effect<AccountJoinReview, LibraryError>;
  }
>()("t3/fork/account-access/AccountJoin") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const identity = yield* ServerEnvironmentIdentity;
  const digest = yield* Digest.Digest;
  const random = yield* SecureRandom.SecureRandom;
  const signature = yield* Signature.Signature;
  const management = yield* LibraryManagement;
  const enrollment = yield* AccountEnrollment;
  const push = yield* LibraryPushService;
  const identityProvider = yield* PocketId;
  // Owns each prompt push, so a slow Apple reply never holds the computer's request open.
  const scope = yield* Effect.scope;
  const revision = yield* SubscriptionRef.make(0);
  const changed = SubscriptionRef.update(revision, (value) => value + 1);
  const enabled = yield* Config.Boolean("LOOM_LIBRARY_AUTHORITY").pipe(Config.withDefault(false));
  const redirect = yield* Config.String("LOOM_IDENTITY_REDIRECT_URI").pipe(Config.option);
  const lock = yield* Semaphore.make(1);
  const root = path.join(config.secretsDir, "account-join");
  const hash = (value: string) =>
    digest
      .digest(Digest.sha256, new TextEncoder().encode(value))
      .pipe(Effect.map(Hex.encode), Effect.mapError(unavailable));
  const fileFor = (requestId: string) =>
    hash(requestId).pipe(Effect.map((id) => path.join(root, `${id}.json`)));
  const save = Effect.fn("AccountJoin.save")(function* (record: Record) {
    yield* writeLibraryCredential({
      file: yield* fileFor(record.review.environmentId),
      contents: yield* encode(record).pipe(Effect.mapError(unavailable)),
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(unavailable),
    );
  });
  const read = Effect.fn("AccountJoin.read")(function* (file: string) {
    const stat = yield* fs.stat(file).pipe(Effect.mapError(unavailable));
    if (stat.type !== "File" || Number(stat.size) > 16384 || (stat.mode & 0o077) !== 0)
      return yield* unavailable();
    return yield* fs
      .readFileString(file)
      .pipe(Effect.flatMap(decode), Effect.mapError(unavailable));
  });
  const records = Effect.fn("AccountJoin.records")(function* () {
    if (!(yield* fs.exists(root).pipe(Effect.mapError(unavailable)))) return [];
    const names = yield* fs.readDirectory(root).pipe(Effect.mapError(unavailable));
    const files = names.filter((name) => /^[a-f0-9]{64}\.json$/u.test(name));
    if (files.length > MAX_REQUESTS) return yield* unavailable();
    const now = yield* Clock.currentTimeMillis;
    const active: Record[] = [];
    for (const name of files) {
      const file = path.join(root, name);
      const record = yield* read(file);
      if (record.review.expiresAt <= now) yield* fs.remove(file).pipe(Effect.mapError(unavailable));
      else active.push(record);
    }
    return active;
  });
  const verify = Effect.fn("AccountJoin.verify")(function* (input: AccountJoinRequest) {
    if (!enabled) return yield* new LibraryError({ reason: "not-authority" });
    const { proof } = input;
    if (
      Option.isNone(redirect) ||
      proof.libraryEnvironmentId !== (yield* identity.getEnvironmentId)
    )
      return yield* refused();
    const audience = yield* Effect.try({
      try: () => new URL(redirect.value).origin,
      catch: refused,
    });
    if (proof.libraryUrl.replace(/\/$/u, "") !== audience) return yield* refused();
    const report = yield* verifyDirectoryReport({
      publicKey: proof.request.publicKey,
      token: proof.request.token,
      environmentId: proof.environmentId,
      audience,
      nowEpochSeconds: (yield* Clock.currentTimeMillis) / 1000,
    }).pipe(Effect.provideService(Signature.Signature, signature), Effect.mapError(refused));
    const key = decodeEd25519PublicKey(proof.request.publicKey);
    if (
      key === null ||
      report.supportsExecution === false ||
      proof.environmentId === proof.libraryEnvironmentId
    )
      return yield* refused();
    return {
      report,
      keyFingerprint: keyFingerprint(key),
      secretHash: yield* hash(Redacted.value(input.secret)),
    };
  });
  const find = Effect.fn("AccountJoin.find")(function* (code: string) {
    if (!isCode(code)) return yield* refused();
    const found = (yield* records()).filter((record) => record.review.code === code);
    if (found.length !== 1) return yield* ended();
    return found[0]!;
  });
  const approvalRefused = (detail: string) => new LibraryError({ reason: "blocked", detail });
  /** On a Library with Loom Identity, approving needs a passkey moment ago or a phone's Face ID. */
  const checkApproval = Effect.fn("AccountJoin.checkApproval")(function* (
    approval: AccountJoinApproval | undefined,
    session: AuthenticatedSession,
  ) {
    // Without Loom Identity there is no passkey to ask for, so the owner session stands alone.
    if (!identityProvider.enabled) return;
    if (approval === undefined) return yield* approvalRefused(ACCOUNT_JOIN_APPROVAL_REQUIRED);
    const failed = (error: PocketIdError) =>
      error.reason === "configuration" || error.reason === "discovery" || error.reason === "session"
        ? unavailable()
        : error.reason === "subject"
          ? approvalRefused(
              "Confirm with the passkey of the Loom Identity account this device is signed in with.",
            )
          : approvalRefused(
              approval._tag === "device"
                ? ACCOUNT_JOIN_DEVICE_APPROVAL_ENDED
                : ACCOUNT_JOIN_APPROVAL_REQUIRED,
            );
    yield* (
      approval._tag === "passkey"
        ? identityProvider.redeemApproval(approval, session.subject)
        : identityProvider.verifyDeviceApproval(approval.token, session.subject)
    ).pipe(Effect.mapError(failed));
  });
  const ownerFor = (session: AuthenticatedSession) => {
    const { expiresAt, ...sessionFields } = session;
    return {
      ...sessionFields,
      ...(expiresAt === undefined ? {} : { expiresAt: DateTime.toUtc(expiresAt) }),
    };
  };
  const begin = Effect.fn("AccountJoin.begin")(function* (input: AccountJoinRequest) {
    const verified = yield* verify(input);
    const active = yield* records();
    const existing = active.find(
      (record) => record.review.environmentId === input.proof.environmentId,
    );
    if (existing && existing.review.keyFingerprint !== verified.keyFingerprint)
      return yield* refused();
    if (existing?.review.requestId === input.proof.requestId) {
      if (
        existing.secretHash !== verified.secretHash ||
        existing.review.environmentId !== input.proof.environmentId ||
        existing.review.keyFingerprint !== verified.keyFingerprint
      )
        return yield* refused();
      if (existing.epoch !== (yield* enrollment.epoch(input.proof.environmentId)))
        return yield* ended();
      return existing.review;
    }
    if (existing === undefined && active.length >= MAX_REQUESTS)
      return yield* new LibraryError({
        reason: "blocked",
        detail:
          "Too many computers are waiting for approval. Wait for an existing code to expire, then try again.",
      });
    const taken = new Set(
      active.flatMap((record) => [record.review.code, ...(record.choices ?? [])]),
    );
    const codes: string[] = [];
    while (codes.length < ACCOUNT_JOIN_PROMPT_CHOICES) {
      const value = Hex.encode(
        yield* random.randomBytes(5).pipe(Effect.mapError(unavailable)),
      ).toUpperCase();
      const next = `${value.slice(0, 5)}-${value.slice(5)}`;
      if (!taken.has(next)) {
        taken.add(next);
        codes.push(next);
      }
    }
    const code = codes[0]!;
    // The true code's position comes from the same random source, so the order tells nothing.
    const [position] = yield* random.randomBytes(1).pipe(Effect.mapError(unavailable));
    const choices = codes.slice(1);
    choices.splice(position! % ACCOUNT_JOIN_PROMPT_CHOICES, 0, code);
    const review: AccountJoinReview = {
      requestId: input.proof.requestId,
      code,
      environmentId: input.proof.environmentId,
      label: verified.report.label,
      keyFingerprint: verified.keyFingerprint,
      state: "pending",
      expiresAt: (yield* Clock.currentTimeMillis) + LIFETIME_MS,
    };
    yield* save({
      version: 1,
      review,
      secretHash: verified.secretHash,
      owner: null,
      epoch: yield* enrollment.epoch(input.proof.environmentId),
      choices,
    });
    yield* changed;
    yield* push
      .joinPrompt({
        libraryEnvironmentId: input.proof.libraryEnvironmentId,
        requestId: review.requestId,
        expiresAt: review.expiresAt,
      })
      .pipe(Effect.forkIn(scope));
    return review;
  }, lock.withPermit);
  const lookup = Effect.fn("AccountJoin.lookup")(function* (
    code: string,
    session: AuthenticatedSession,
  ) {
    yield* management.authorizeEnrollment(session);
    return (yield* find(code)).review;
  }, lock.withPermit);
  const decide = Effect.fn("AccountJoin.decide")(function* (
    input: {
      readonly code: string;
      readonly approve: boolean;
      readonly approval?: AccountJoinApproval;
    },
    session: AuthenticatedSession,
  ) {
    yield* management.authorizeEnrollment(session);
    const record = yield* find(input.code);
    if (record.epoch !== (yield* enrollment.epoch(record.review.environmentId)))
      return yield* ended();
    const next = input.approve ? "approved" : "denied";
    if (record.review.state === next) return record.review;
    if (record.review.state !== "pending") return yield* ended();
    if (input.approve) yield* checkApproval(input.approval, session);
    const review: AccountJoinReview = { ...record.review, state: next };
    yield* save({ ...record, review, owner: input.approve ? ownerFor(session) : null });
    yield* changed;
    return review;
  }, lock.withPermit);
  const redeem = Effect.fn("AccountJoin.redeem")(function* (
    input: AccountJoinRequest,
  ): Effect.fn.Return<AccountJoinRedemption, LibraryError> {
    const verified = yield* verify(input);
    const file = yield* fileFor(input.proof.environmentId);
    if (!(yield* fs.exists(file).pipe(Effect.mapError(unavailable)))) return yield* ended();
    const record = yield* read(file);
    if (record.review.expiresAt <= (yield* Clock.currentTimeMillis)) return yield* ended();
    if (
      record.review.requestId !== input.proof.requestId ||
      record.secretHash !== verified.secretHash ||
      record.review.environmentId !== input.proof.environmentId ||
      record.review.keyFingerprint !== verified.keyFingerprint
    )
      return yield* refused();
    if (record.review.state !== "approved") return { state: record.review.state };
    if (record.owner === null) return yield* unavailable();
    return {
      state: "approved",
      enrollment: yield* enrollment.approve(input.proof, record.owner, record.epoch),
    };
  }, lock.withPermit);
  const pending = Effect.fn("AccountJoin.pending")(function* (session: AuthenticatedSession) {
    yield* management.authorizeEnrollment(session);
    const prompts: AccountJoinPrompt[] = [];
    for (const record of yield* records()) {
      if (record.review.state !== "pending" || record.choices === undefined) continue;
      if (record.epoch !== (yield* enrollment.epoch(record.review.environmentId))) continue;
      const { requestId, environmentId, label, keyFingerprint, expiresAt } = record.review;
      prompts.push({
        requestId,
        environmentId,
        label,
        keyFingerprint,
        expiresAt,
        choices: record.choices,
      });
    }
    return prompts.toSorted((left, right) => left.expiresAt - right.expiresAt);
  }, lock.withPermit);
  // Each change re-checks the session, so a revoked sign-in stops seeing requests.
  const prompts = (session: AuthenticatedSession) =>
    SubscriptionRef.changes(revision).pipe(
      Stream.mapEffect(() => pending(session)),
      Stream.changesWith(
        (left, right) =>
          left.length === right.length &&
          left.every((prompt, index) => prompt.requestId === right[index]?.requestId),
      ),
    );
  const respond = Effect.fn("AccountJoin.respond")(function* (
    input: AccountJoinResponse,
    session: AuthenticatedSession,
  ) {
    yield* management.authorizeEnrollment(session);
    const found = (yield* records()).filter(
      (record) => record.review.requestId === input.requestId,
    );
    if (found.length !== 1) return yield* ended();
    const record = found[0]!;
    if (record.epoch !== (yield* enrollment.epoch(record.review.environmentId)))
      return yield* ended();
    const matches = input.code !== null && input.code === record.review.code;
    const next = matches ? "approved" : "denied";
    if (record.review.state !== "pending")
      return record.review.state === next ? record.review : yield* ended();
    if (matches) yield* checkApproval(input.approval, session);
    const review: AccountJoinReview = { ...record.review, state: next };
    yield* save({ ...record, review, owner: matches ? ownerFor(session) : null });
    yield* changed;
    return review;
  }, lock.withPermit);
  return AccountJoin.of({ begin, lookup, decide, redeem, prompts, respond });
});
export const layer = Layer.effect(AccountJoin, make);
