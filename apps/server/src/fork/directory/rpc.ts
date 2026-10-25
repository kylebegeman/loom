import { DIRECTORY_WS_METHODS as DIR, type DirectoryForgetRequest } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { DirectoryReporter } from "./DirectoryReporter.ts";
import { DirectoryService } from "./DirectoryService.ts";

export const makeDirectoryRpcHandlers = Effect.fn("Directory.makeRpcHandlers")(function* (
  auth: ForkRpcAuth,
) {
  const service = yield* DirectoryService;
  const reporter = yield* DirectoryReporter;
  return {
    [DIR.list]: () => auth.effect(DIR.list, service.computers),
    [DIR.forget]: (input: DirectoryForgetRequest) => auth.effect(DIR.forget, service.forget(input)),
    [DIR.reporting]: () => auth.effect(DIR.reporting, reporter.status),
  };
});
