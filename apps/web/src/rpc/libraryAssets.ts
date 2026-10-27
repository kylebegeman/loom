import { createEnvironmentCommand } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import {
  issueRemoteWebSocketTicket,
  issueRemoteDpopWebSocketTicket,
} from "@t3tools/client-runtime/authorization";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { environmentEndpointUrl } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ChatAttachmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { connectionAtomRuntime } from "~/connection/runtime";

class LibraryAssetAccessError extends Schema.TaggedError<LibraryAssetAccessError>()(
  "LibraryAssetAccessError",
  { detail: Schema.String },
) {
  override get message() {
    return this.detail;
  }
}

function libraryAssetPath(sourceEnvironmentId: EnvironmentId, attachmentId: ChatAttachmentId) {
  return `/api/loom/library/assets/${encodeURIComponent(sourceEnvironmentId)}/${encodeURIComponent(attachmentId)}`;
}

function libraryRecoveryPath(sourceEnvironmentId: EnvironmentId, copyId: string, sha256: string) {
  return `/api/loom/library/recovery/${encodeURIComponent(sourceEnvironmentId)}/${encodeURIComponent(copyId)}/${encodeURIComponent(sha256)}`;
}

/** Fresh, single-use tickets let browsers download protected files without exposing credentials. */
const protectedLibraryResourceUrl = Effect.fn("web.library.resourceAccess")(function* (
  resourcePath: string,
) {
  const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
  const prepared = yield* SubscriptionRef.get(supervisor.prepared);
  if (Option.isNone(prepared))
    return yield* new LibraryAssetAccessError({
      detail: "Reconnect your Library to download saved files.",
    });
  const connection = prepared.value;
  const url = new URL(environmentEndpointUrl(connection.httpBaseUrl, resourcePath));
  const authorization = connection.httpAuthorization;
  if (!authorization) return url.href;
  if (authorization._tag === "Bearer") {
    const ticket = yield* issueRemoteWebSocketTicket({
      httpBaseUrl: connection.httpBaseUrl,
      bearerToken: authorization.token,
    });
    url.searchParams.set("wsTicket", ticket.ticket);
    return url.href;
  }
  const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
  if (Option.isNone(signer))
    return yield* new LibraryAssetAccessError({
      detail: "Reconnect T3 Connect before downloading saved files.",
    });
  const proof = yield* signer.value.createProof({
    method: "POST",
    url: environmentEndpointUrl(connection.httpBaseUrl, "/api/auth/websocket-ticket"),
    accessToken: authorization.accessToken,
  });
  const ticket = yield* issueRemoteDpopWebSocketTicket({
    httpBaseUrl: connection.httpBaseUrl,
    accessToken: authorization.accessToken,
    dpopProof: proof,
  });
  url.searchParams.set("wsTicket", ticket.ticket);
  return url.href;
});

export const libraryAssetAccess = createEnvironmentCommand(connectionAtomRuntime, {
  label: "loom:library:asset-access",
  execute: (input: {
    readonly sourceEnvironmentId: EnvironmentId;
    readonly attachmentId: ChatAttachmentId;
  }) =>
    protectedLibraryResourceUrl(libraryAssetPath(input.sourceEnvironmentId, input.attachmentId)),
});

export const libraryRecoveryAccess = createEnvironmentCommand(connectionAtomRuntime, {
  label: "loom:library:recovery-access",
  execute: (input: {
    readonly sourceEnvironmentId: EnvironmentId;
    readonly copyId: string;
    readonly sha256: string;
  }) =>
    protectedLibraryResourceUrl(
      libraryRecoveryPath(input.sourceEnvironmentId, input.copyId, input.sha256),
    ),
});
