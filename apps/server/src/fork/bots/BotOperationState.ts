import { BotOperationMode, BotsError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const modeJson = Schema.fromJsonString(BotOperationMode);
const decodeMode = Schema.decodeUnknownOption(modeJson);
const encodeMode = Schema.encodeSync(modeJson);
const storageError = () =>
  new BotsError({
    reason: "storage",
    message: "Loom could not read or write bot operation settings.",
  });

export const makeBotOperationState = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const getMode = Effect.fn("BotOperationState.getMode")(function* () {
    const rows = yield* sql<{
      value_json: string;
    }>`SELECT value_json FROM fork_bots_settings WHERE key = 'operation-mode'`.pipe(
      Effect.mapError(storageError),
    );
    if (rows.length === 0) return "manual" as const;
    const decoded = decodeMode(rows[0]?.value_json);
    if (decoded._tag === "None") return yield* storageError();
    return decoded.value;
  });
  const setMode = Effect.fn("BotOperationState.setMode")(function* (mode: BotOperationMode) {
    yield* sql`INSERT INTO fork_bots_settings (key,value_json) VALUES ('operation-mode', ${encodeMode(mode)}) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`.pipe(
      Effect.mapError(storageError),
    );
    return mode;
  });
  const checkAdmission = Effect.fn("BotOperationState.checkAdmission")(function* (
    triggered: boolean,
  ) {
    const mode = yield* getMode();
    if (mode === "paused")
      return yield* new BotsError({
        reason: "invalid",
        message: "Bots are paused on this computer. Choose Manual or Automatic to start new jobs.",
      });
    if (triggered && mode !== "automatic")
      return yield* new BotsError({
        reason: "invalid",
        message: "Bot triggers require Automatic mode on this computer.",
      });
  });
  return { getMode, setMode, checkAdmission };
});
