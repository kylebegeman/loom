import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { makeEnvironmentHttpApiClient, request, runStream } from "@t3tools/client-runtime/rpc";
import {
  type EnvironmentId,
  type EnvironmentCloudLinkStateResult,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { linkEnvironmentToCloud } from "../../../features/cloud/linkEnvironment";
import type { SavedRemoteConnection } from "../../../lib/connection";

export class SelectedComputerConnectError extends Data.TaggedError("SelectedComputerConnectError")<{
  readonly message: string;
  readonly reason?: "previous-link";
}> {}

export interface SelectedComputerTarget {
  readonly environmentId: EnvironmentId;
  readonly connection: SavedRemoteConnection | null;
  /** Re-read the selected host's grant at execution, including after asynchronous work. */
  readonly canConfigure: () => boolean;
}
export interface SelectedComputerAccount {
  readonly accountId: string;
  readonly clerkToken: string;
  readonly isCurrent: () => boolean;
}

function pairedConnection(target: SelectedComputerTarget) {
  return Effect.gen(function* () {
    if (!target.canConfigure()) {
      return yield* new SelectedComputerConnectError({
        message: "Connect management permission is required on this computer.",
      });
    }
    const connection = target.connection;
    if (!connection || connection.environmentId !== target.environmentId) {
      return yield* new SelectedComputerConnectError({
        message: "The selected computer's connection is unavailable. Reconnect and try again.",
      });
    }
    if (
      !connection.bearerToken ||
      connection.authenticationMethod === "dpop" ||
      connection.relayManaged
    ) {
      return yield* new SelectedComputerConnectError({
        message: "Use a directly paired route to configure this computer's account link.",
      });
    }
    const environmentHttp = yield* makeEnvironmentHttpApiClient(connection.httpBaseUrl);
    const descriptor = yield* environmentHttp.metadata.descriptor({});
    if (descriptor.environmentId !== target.environmentId) {
      return yield* new SelectedComputerConnectError({
        message:
          "This address now belongs to a different computer. Pair the selected computer again.",
      });
    }
    return {
      environmentHttp,
      connection,
      headers: { authorization: `Bearer ${connection.bearerToken}` },
    };
  });
}

function requireAccount(account: SelectedComputerAccount) {
  return account.isCurrent() && account.clerkToken
    ? Effect.void
    : Effect.fail(
        new SelectedComputerConnectError({
          message: "Sign in to Connect again before changing this computer's account link.",
        }),
      );
}

export function getSelectedComputerConnectState(target: SelectedComputerTarget) {
  return Effect.gen(function* () {
    const { environmentHttp, headers } = yield* pairedConnection(target);
    return yield* environmentHttp.connect.linkState({ headers });
  });
}

function requireLinkedAccount(
  state: EnvironmentCloudLinkStateResult,
  account: SelectedComputerAccount,
) {
  return state.linked && state.cloudUserId !== account.accountId
    ? Effect.fail(
        new SelectedComputerConnectError({
          message:
            "This computer is linked to another Connect account. Sign in to that account to manage its link.",
        }),
      )
    : Effect.void;
}

function requireUnregistered(
  relay: ManagedRelay.ManagedRelayClient["Service"],
  target: SelectedComputerTarget,
  account: SelectedComputerAccount,
) {
  return Effect.gen(function* () {
    const registered = yield* relay.listEnvironments({ clerkToken: account.clerkToken });
    if (registered.some((entry) => entry.environmentId === target.environmentId)) {
      return yield* new SelectedComputerConnectError({
        message:
          "This account still has a previous link for this computer. Unlink it from the account, then link it again.",
        reason: "previous-link",
      });
    }
  });
}

function prepareRelayClient(target: SelectedComputerTarget) {
  return Effect.gen(function* () {
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const status = yield* registry.run(
      target.environmentId,
      request(WS_METHODS.cloudGetRelayClientStatus, {}),
    );
    if (status.status === "available") return;
    if (status.status === "unsupported") {
      return yield* new SelectedComputerConnectError({
        message: `The tunnel helper is unavailable on ${status.platform}-${status.arch}.`,
      });
    }
    if (!target.canConfigure()) {
      return yield* new SelectedComputerConnectError({
        message: "Connect management permission is required on this computer.",
      });
    }
    const installed = yield* registry
      .runStream(target.environmentId, runStream(WS_METHODS.cloudInstallRelayClient, {}))
      .pipe(Stream.runLast);
    if (
      Option.isNone(installed) ||
      installed.value.type !== "complete" ||
      installed.value.status.status !== "available"
    ) {
      return yield* new SelectedComputerConnectError({
        message: "The tunnel helper could not be installed. Try linking again.",
      });
    }
  });
}

/** New links use neutral delivery settings; observed existing links are preserved. */
export function linkSelectedComputer(
  target: SelectedComputerTarget,
  account: SelectedComputerAccount,
) {
  return Effect.gen(function* () {
    yield* requireAccount(account);
    const { environmentHttp, headers } = yield* pairedConnection(target);
    const state = yield* environmentHttp.connect.linkState({ headers });
    yield* requireLinkedAccount(state, account);
    if (state.linked) return;
    const relay = yield* ManagedRelay.ManagedRelayClient;
    yield* requireUnregistered(relay, target, account);
    yield* prepareRelayClient(target);
    yield* requireAccount(account);
    if (!target.canConfigure()) {
      return yield* new SelectedComputerConnectError({
        message: "Connect management permission is required on this computer.",
      });
    }
    const current = yield* pairedConnection(target);
    const currentState = yield* current.environmentHttp.connect.linkState({
      headers: current.headers,
    });
    yield* requireLinkedAccount(currentState, account);
    if (currentState.linked) return;
    yield* requireUnregistered(relay, target, account);
    yield* requireAccount(account);
    if (!target.canConfigure()) {
      return yield* new SelectedComputerConnectError({
        message: "Connect management permission is required on this computer.",
      });
    }
    yield* linkEnvironmentToCloud({
      connection: current.connection,
      clerkToken: account.clerkToken,
      notificationsEnabled: false,
      liveActivitiesEnabled: false,
      canContinue: () => account.isCurrent() && target.canConfigure(),
    });
  });
}

/** Stop this host first, then remove its exact account record. Failures remain visible and retryable. */
export function unlinkSelectedComputer(
  target: SelectedComputerTarget,
  account: SelectedComputerAccount,
) {
  return Effect.gen(function* () {
    yield* requireAccount(account);
    const { environmentHttp, headers } = yield* pairedConnection(target);
    const state = yield* environmentHttp.connect.linkState({ headers });
    yield* requireLinkedAccount(state, account);
    if (!target.canConfigure()) {
      return yield* new SelectedComputerConnectError({
        message: "Connect management permission is required on this computer.",
      });
    }
    yield* requireAccount(account);
    yield* environmentHttp.connect.unlink({ headers });
    yield* requireAccount(account);
    const relay = yield* ManagedRelay.ManagedRelayClient;
    yield* relay.unlinkEnvironment({
      clerkToken: account.clerkToken,
      environmentId: target.environmentId,
    });
  });
}
