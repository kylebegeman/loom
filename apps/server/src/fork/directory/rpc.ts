import { DIRECTORY_WS_METHODS as DIR, type DirectoryForgetRequest } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { DirectoryService } from "./DirectoryService.ts";

export const makeDirectoryRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const service = yield* DirectoryService;
    return {
      [DIR.list]: () => auth.effect(DIR.list, service.list),
      [DIR.forget]: (input: DirectoryForgetRequest) =>
        auth.effect(DIR.forget, service.forget(input)),
    };
  });
