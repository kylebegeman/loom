import {
  BOTS_WS_METHODS as B,
  type BotsListRunsInput,
  type BotsRunInput,
  type BotsSaveInput,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { BotsService, USER_CALLER } from "./BotsService.ts";

export const makeBotsRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const service = yield* BotsService;
    return {
      [B.list]: () => auth.effect(B.list, service.list().pipe(Effect.map((bots) => ({ bots })))),
      [B.save]: (input: BotsSaveInput) => auth.effect(B.save, service.save(input, USER_CALLER)),
      [B.archive]: (input: { botId: string; archived: boolean }) =>
        auth.effect(B.archive, service.archive(input.botId, input.archived)),
      [B.delete]: (input: { botId: string }) =>
        auth.effect(B.delete, service.delete(input.botId).pipe(Effect.as({}))),
      [B.run]: (input: BotsRunInput) => auth.effect(B.run, service.run(input, USER_CALLER)),
      [B.cancel]: (input: { runId: string }) => auth.effect(B.cancel, service.cancel(input.runId)),
      [B.listRuns]: (input: BotsListRunsInput) => auth.effect(B.listRuns, service.listRuns(input)),
      [B.watch]: () => auth.stream(B.watch, service.changes),
    };
  });
