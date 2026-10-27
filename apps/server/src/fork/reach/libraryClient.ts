import {
  REACH_ENSURE_ROUTE,
  REACH_REMOVE_ROUTE,
  type ReachAction,
  ReachEnsureReply,
  type ReachError,
  ReachFailureReply,
  type ReachFailureReason,
  ReachRemoveReply,
} from "@t3tools/contracts/fork";
import { directoryPublicKeyFromPem } from "@t3tools/shared/fork/directory";
import { isReachHostname, signReachRequest } from "@t3tools/shared/fork/reach";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { HttpClientRequest, type HttpClientResponse } from "effect/http";
import type * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "../../cloud/environmentKeys.ts";
import type { LibraryConnection } from "../project-library/LibraryConnection.ts";

export type RemoteLibrary = Extract<LibraryConnection, { readonly kind: "remote" }>;

/**
 * What one signed request came to. `outdated` is a 404 without a reach reason: a Library older
 * than reach. `invalid` is a success or refusal this computer cannot use. `storage` never sent
 * anything, because the key or the next `seq` could not be read or saved.
 */
export type ReachLibraryOutcome<A> =
  | { readonly kind: "ok"; readonly reply: A }
  | {
      readonly kind: "refused";
      readonly reason: ReachFailureReason;
      readonly retryAfterSeconds: number | null;
    }
  | { readonly kind: "outdated" }
  | { readonly kind: "signed-out" }
  | { readonly kind: "io" }
  | { readonly kind: "invalid" }
  | { readonly kind: "storage" };
export type ReachLibraryFailure = Exclude<ReachLibraryOutcome<never>, { readonly kind: "ok" }>;

export interface ReachLibraryClientOptions {
  readonly library: RemoteLibrary;
  readonly environmentId: string;
  readonly secrets: ServerSecretStore.ServerSecretStore["Service"];
  readonly lastSeq: () => number;
  /** Saves `seq` before the request leaves, so no restart ever signs the same one twice. */
  readonly saveSeq: (seq: number) => Effect.Effect<void, ReachError>;
}

export interface ReachLibraryClient {
  /** Asks the Library to point this computer's tunnel at `origin` and hand over a fresh token. */
  readonly ensure: (origin: string) => Effect.Effect<ReachLibraryOutcome<ReachEnsureReply>>;
  readonly remove: () => Effect.Effect<ReachLibraryOutcome<ReachRemoveReply>>;
}

const failed = <K extends ReachLibraryFailure["kind"]>(kind: K) => ({ kind }) as const;

const isJson = (response: HttpClientResponse.HttpClientResponse) =>
  /^application\/json\b/i.test(response.headers["content-type"] ?? "");

// An ensure reply carries the connector token and Schema issues echo their input, so every decode
// keeps only whether it worked.
const decodeEnsure = Schema.decodeUnknownEffect(ReachEnsureReply);
const decodeRemove = Schema.decodeUnknownEffect(ReachRemoveReply);
const decodeFailure = Schema.decodeUnknownEffect(ReachFailureReply);
/** Any refusal body, including a reason from a newer Library that this computer does not know. */
const isRefusal = Schema.is(Schema.Struct({ reason: Schema.String }));

/** Signs and sends ensure and remove for one Library connection. Bodies are never logged. */
export const makeReachLibraryClient = (options: ReachLibraryClientOptions): ReachLibraryClient => {
  const { library } = options;

  const send = Effect.fnUntraced(function* <A>(
    action: ReachAction,
    origin: string | undefined,
    decode: (body: unknown) => Effect.Effect<A, unknown>,
  ): Effect.fn.Return<ReachLibraryOutcome<A>> {
    const keyPair = yield* getOrCreateEnvironmentKeyPairFromSecretStore(options.secrets).pipe(
      Effect.option,
    );
    if (Option.isNone(keyPair)) return failed("storage");
    const publicKey = directoryPublicKeyFromPem(keyPair.value.publicKey);
    if (publicKey === null) return failed("invalid");
    const nowMs = yield* Clock.currentTimeMillis;
    const seq = Math.max(nowMs, options.lastSeq() + 1);
    const saved = yield* Effect.result(options.saveSeq(seq));
    if (Result.isFailure(saved)) return failed("storage");
    const token = yield* signReachRequest({
      privateKey: keyPair.value.privateKey,
      environmentId: options.environmentId,
      audience: library.origin,
      claims: origin === undefined ? { action, seq } : { action, seq, origin },
      nowEpochSeconds: nowMs / 1000,
    }).pipe(Effect.option);
    if (Option.isNone(token)) return failed("invalid");
    const route = action === "ensure" ? REACH_ENSURE_ROUTE : REACH_REMOVE_ROUTE;
    const sent = yield* library
      .send(
        HttpClientRequest.post(library.endpoint(route)).pipe(
          HttpClientRequest.bodyJsonUnsafe({ token: token.value, publicKey }),
        ),
      )
      .pipe(Effect.result);
    if (Result.isFailure(sent)) {
      return sent.failure.reason === "blocked" ? failed("signed-out") : failed("io");
    }
    const response = sent.success;
    if (response.status >= 200 && response.status < 300) {
      // A sign-in page or proxy answer is not the Library's reply.
      if (!isJson(response)) return failed("io");
      const reply = yield* response.json.pipe(Effect.flatMap(decode), Effect.option);
      return Option.isNone(reply) ? failed("invalid") : { kind: "ok", reply: reply.value };
    }
    const body = isJson(response) ? yield* Effect.option(response.json) : Option.none();
    if (Option.isSome(body)) {
      const refusal = yield* Effect.option(decodeFailure(body.value));
      if (Option.isSome(refusal)) {
        return {
          kind: "refused",
          reason: refusal.value.reason,
          retryAfterSeconds: refusal.value.retryAfterSeconds ?? null,
        };
      }
      // A Library that runs reach sent it, so its status says nothing about age or sign-in.
      if (isRefusal(body.value)) return failed("invalid");
    }
    if (response.status === 404) return failed("outdated");
    if (response.status === 401 || response.status === 403) return failed("signed-out");
    return failed("io");
  });

  /** A `seq` the Library already passed came from a lost or older sidecar; one fresh try fixes it. */
  const call = <A>(
    action: ReachAction,
    origin: string | undefined,
    decode: (body: unknown) => Effect.Effect<A, unknown>,
  ) =>
    send(action, origin, decode).pipe(
      Effect.filterOrElse(
        (outcome) => !(outcome.kind === "refused" && outcome.reason === "stale-request"),
        () => send(action, origin, decode),
      ),
    );

  const ensure = Effect.fn("ReachLibrary.ensure")(function* (origin: string) {
    const outcome = yield* call("ensure", origin, decodeEnsure);
    if (outcome.kind !== "ok") return outcome;
    if (outcome.reply.origin !== origin) {
      yield* Effect.logWarning("The Library pointed reach at another address on this computer", {
        expected: origin,
        received: outcome.reply.origin,
      });
      return failed("invalid");
    }
    // The guard applies the allowlist to this hostname, so it must never name another host.
    if (!isReachHostname(outcome.reply.hostname.toLowerCase())) return failed("invalid");
    return outcome;
  });

  const remove = Effect.fn("ReachLibrary.remove")(function* () {
    return yield* call("remove", undefined, decodeRemove);
  });

  return { ensure, remove };
};
