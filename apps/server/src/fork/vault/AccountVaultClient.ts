import type { ThreadId } from "@t3tools/contracts";
import {
  ACCOUNT_VAULT_ROUTE,
  AccountVaultRequest,
  AccountVaultResponse,
  AccountVaultFailure,
  VaultError,
  type VaultSshError,
  type VaultGitHubRunInput,
  type VaultGitHubResult,
  VaultGitHubError,
  type VaultConnectionError,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClientRequest, HttpIncomingMessage } from "effect/http";
import * as AccountWorkloads from "../account-access/AccountWorkloads.ts";
import * as LibraryConnection from "../project-library/LibraryConnection.ts";

const encodeRequest = Schema.encodeEffect(Schema.fromJsonString(AccountVaultRequest));
const decodeResponse = Schema.decodeUnknownEffect(AccountVaultResponse);
const decodeFailure = Schema.decodeUnknownEffect(AccountVaultFailure);
const unavailable = () => new VaultError({ reason: "unavailable" });
export class AccountVaultClient extends Context.Service<
  AccountVaultClient,
  {
    readonly available: Effect.Effect<boolean, VaultError>;
    readonly execute: (
      request: Exclude<AccountVaultRequest, { readonly kind: "github" }>,
      threadId: ThreadId,
    ) => Effect.Effect<AccountVaultResponse, VaultError | VaultSshError>;
    readonly github: (
      input: VaultGitHubRunInput,
      threadId: ThreadId,
    ) => Effect.Effect<VaultGitHubResult, VaultError | VaultGitHubError | VaultConnectionError>;
  }
>()("t3/fork/vault/AccountVaultClient") {}
const make = Effect.gen(function* () {
  const connection = yield* LibraryConnection.LibraryConnectionService;
  const workloads = yield* AccountWorkloads.AccountWorkloads;
  const random = yield* SecureRandom.SecureRandom;
  const post = Effect.fn("AccountVaultClient.post")(function* (
    request: AccountVaultRequest,
    threadId: ThreadId,
  ) {
    const transportFailure = () =>
      request.kind === "github"
        ? new VaultGitHubError({
            reason: "failed",
            ...(request.operationId ? { operationId: request.operationId } : {}),
          })
        : unavailable();
    const current = yield* connection.current.pipe(Effect.mapError(unavailable));
    if (current.kind !== "remote" || current.credential?.account === undefined)
      return yield* new VaultError({ reason: "denied" });
    const payload = yield* encodeRequest(request).pipe(
      Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
    );
    const proof = yield* workloads.prepare(payload, threadId);
    const latest = yield* connection.current.pipe(Effect.mapError(unavailable));
    if (
      latest.kind !== "remote" ||
      latest.origin !== current.origin ||
      latest.credential?.libraryEnvironmentId !== current.credential.libraryEnvironmentId ||
      latest.credential.account?.authorityId !== current.credential.account.authorityId ||
      latest.credential.account.authorityEpoch !== current.credential.account.authorityEpoch
    )
      return yield* new VaultError({ reason: "denied" });
    const httpRequest = yield* HttpClientRequest.bodyJson(
      HttpClientRequest.post(ACCOUNT_VAULT_ROUTE),
      { payload, proof },
    ).pipe(Effect.mapError(unavailable));
    const response = yield* latest
      .send(httpRequest)
      .pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.timeout("15 seconds"),
        Effect.mapError(transportFailure),
      );
    const body = response.json.pipe(
      Effect.provideService(
        HttpIncomingMessage.MaxBodySize,
        ByteSize.kibibytes(request.kind === "github" ? 512 : 96),
      ),
      Effect.timeout("15 seconds"),
    );
    if (response.status !== 200) {
      const error = yield* body.pipe(
        Effect.flatMap(decodeFailure),
        Effect.orElseSucceed(() =>
          response.status === 401 || response.status === 403
            ? new VaultError({ reason: "denied" })
            : transportFailure(),
        ),
      );
      return yield* error;
    }
    const decoded = yield* body.pipe(
      Effect.flatMap(decodeResponse),
      Effect.mapError(transportFailure),
    );
    if (decoded.kind !== request.kind) return yield* transportFailure();
    return decoded;
  });
  return AccountVaultClient.of({
    available: connection.current.pipe(
      Effect.map(
        (current) => current.kind === "remote" && current.credential?.account !== undefined,
      ),
      Effect.mapError(unavailable),
    ),
    execute: Effect.fn("AccountVaultClient.execute")(function* (request, threadId) {
      return yield* post(request, threadId).pipe(
        Effect.catchTags({
          VaultGitHubError: () => Effect.fail(unavailable()),
          VaultConnectionError: () => Effect.fail(unavailable()),
        }),
      );
    }),
    github: Effect.fn("AccountVaultClient.github")(function* (input, threadId) {
      const tracked =
        input.operationId !== undefined ||
        ["pr-comment", "issue-comment", "issue-create"].includes(input.operation.action);
      const operationId = tracked
        ? (input.operationId ??
          (yield* random.uuidV4().pipe(
            Effect.map((id) => id.replaceAll("-", "")),
            Effect.mapError(unavailable),
          )))
        : undefined;
      const result = yield* post(
        {
          kind: "github",
          input,
          ...(operationId
            ? { operationId, mode: input.operationId ? ("recover" as const) : ("start" as const) }
            : {}),
        },
        threadId,
      ).pipe(
        Effect.catchTags({
          VaultSshError: () => Effect.fail(unavailable()),
        }),
      );
      if (result.kind !== "github") return yield* unavailable();
      if (operationId && result.result.operationId !== operationId)
        return yield* new VaultGitHubError({ reason: "failed", operationId });
      return result.result;
    }),
  });
});
export const layer = Layer.effect(AccountVaultClient, make).pipe(
  Layer.provide(SecureRandom.layerWebCrypto),
);
