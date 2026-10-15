import { PROJECT_RESOURCES_WS_METHODS as R } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as ProjectResources from "../../project/ProjectResources.ts";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";

export const makeProjectResourcesRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const service = yield* ProjectResources.ProjectResources;
    return {
      [R.get]: (input: Parameters<typeof service.get>[0]) => auth.effect(R.get, service.get(input)),
      [R.upsert]: (input: Parameters<typeof service.upsert>[0]) =>
        auth.effect(R.upsert, service.upsert(input)),
      [R.remove]: (input: Parameters<typeof service.remove>[0]) =>
        auth.effect(R.remove, service.remove(input)),
    };
  });
