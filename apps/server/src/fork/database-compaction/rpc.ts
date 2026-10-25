import {
  DATABASE_COMPACTION_WS_METHODS,
  DatabaseCompactionRpcGroup,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";

import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import * as DatabaseStorage from "../../persistence/DatabaseStorage.ts";
import { makeForkRpcAuth } from "../rpcAuthorization.ts";

/**
 * Served beside makeForkRpcLayer (ws.ts, fork: restart-compaction) rather than
 * inside it: the request belongs to DatabaseStorage, and ForkLayer is built
 * beneath the core services, so withForkRuntime cannot reach it.
 */
export const makeDatabaseCompactionRpcLayer = (session: AuthenticatedSession) =>
  DatabaseCompactionRpcGroup.toLayer(
    Effect.gen(function* () {
      const databaseStorage = yield* DatabaseStorage.DatabaseStorage;
      const auth = makeForkRpcAuth(session);
      return DatabaseCompactionRpcGroup.of({
        [DATABASE_COMPACTION_WS_METHODS.setRequest]: ({ requested }) =>
          auth.effect(
            DATABASE_COMPACTION_WS_METHODS.setRequest,
            databaseStorage.requestRestartCompaction(requested),
          ),
      });
    }),
  );
