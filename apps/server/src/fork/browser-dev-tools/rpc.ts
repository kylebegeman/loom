import { DevApiService } from "./DevApiService.ts";
import { DevRequestsService } from "./DevRequestsService.ts";
import { DevDiagnosticsService } from "./DevDiagnosticsService.ts";
import type { DevDiagnosticsTarget } from "@t3tools/contracts/fork";
import {
  DEV_ENVIRONMENT_WS_METHODS as D,
  type DevHttpSend,
  type DevApiImport,
  type DevApiRead,
  type DevApiEnvironmentTarget,
  type DevApiSaveEnvironment,
  type DevApiRun,
  type DevApiSaveRequest,
  VAULT_CORE_WS_METHODS as V,
  VaultError,
  type DevApiWorkspaceTarget,
  type DevHttpHistoryTarget,
  type DevTarget,
  type DevStart,
  type DevControl,
  type DevCompose,
  type DevDatabaseAction,
  type DevDatabaseKind,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import { DevEnvironmentService } from "./DevEnvironmentService.ts";
import { DevContainersService } from "./DevContainersService.ts";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
export const makeDevEnvironmentRpcHandlers = Effect.fn("DevEnvironment.rpc")(function* (
  auth: ForkRpcAuth,
  actor: string,
) {
  const api = yield* DevApiService;
  const requests = yield* DevRequestsService;
  const diagnostics = yield* DevDiagnosticsService;
  const dev = yield* DevEnvironmentService;
  const containers = yield* DevContainersService;
  return {
    [D.apiList]: (input: DevTarget) => auth.effect(D.apiList, api.list(input)),
    [D.apiImport]: (input: DevApiImport) => auth.effect(D.apiImport, api.import(input)),
    [D.apiRead]: (input: DevApiRead) => auth.effect(D.apiRead, api.read(input)),
    [D.apiEnvironment]: (input: DevApiEnvironmentTarget) =>
      auth.effect(D.apiEnvironment, api.environment(input)),
    [D.apiSaveEnvironment]: (input: DevApiSaveEnvironment) =>
      auth.effect(D.apiSaveEnvironment, api.saveEnvironment(input)),
    [D.apiSaveRequest]: (input: DevApiSaveRequest) =>
      auth.effect(D.apiSaveRequest, api.saveRequest(input)),
    [D.apiExport]: (input: DevApiWorkspaceTarget) => auth.effect(D.apiExport, api.export(input)),
    [D.apiRun]: (input: DevApiRun) =>
      auth.effect(
        D.apiRun,
        api.run(input, {
          kind: "client",
          actor,
          authorize: auth
            .effect(V.reveal, Effect.void)
            .pipe(Effect.mapError(() => new VaultError({ reason: "denied" }))),
        }),
      ),
    [D.apiRemove]: (input: DevApiWorkspaceTarget) => auth.effect(D.apiRemove, api.remove(input)),
    [D.httpSend]: (input: DevHttpSend) => auth.effect(D.httpSend, requests.send(input)),
    [D.httpHistory]: (input: DevHttpHistoryTarget) =>
      auth.effect(D.httpHistory, requests.history(input)),
    [D.httpClear]: (input: DevTarget) => auth.effect(D.httpClear, requests.clear(input)),
    [D.diagnostics]: (input: DevDiagnosticsTarget) =>
      auth.effect(D.diagnostics, diagnostics.read(input)),
    [D.snapshot]: (input: DevTarget) => auth.effect(D.snapshot, dev.snapshot(input)),
    [D.watch]: (input: DevTarget) => auth.stream(D.watch, dev.watch(input)),
    [D.start]: (input: DevStart) => auth.effect(D.start, dev.start(input)),
    [D.control]: (input: DevControl) => auth.effect(D.control, dev.control(input)),
    [D.containers]: (input: DevTarget) => auth.effect(D.containers, containers.list(input)),
    [D.compose]: (input: DevCompose) => auth.effect(D.compose, containers.compose(input)),
    [D.database]: (input: DevDatabaseAction) => auth.effect(D.database, containers.database(input)),
    [D.databaseUrl]: (input: DevTarget & { kind: DevDatabaseKind }) =>
      auth.effect(D.databaseUrl, containers.databaseUrl(input)),
  };
});
