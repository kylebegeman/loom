// fork: attention-status
import { BotRun } from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";

const REASON_MAX_CHARS = 240;
export const BotInboxSummary = Schema.Struct({
  id: BotRun.fields.id,
  botId: BotRun.fields.botId,
  botName: BotRun.fields.botName,
  threadId: BotRun.fields.threadId,
  status: BotRun.fields.status,
  callerThreadId: BotRun.fields.callerThreadId,
  createdAt: BotRun.fields.createdAt,
  finishedAt: BotRun.fields.finishedAt,
  reason: Schema.String,
});

export function botInboxSummary(
  run: Pick<
    BotRun,
    | "id"
    | "botId"
    | "botName"
    | "threadId"
    | "status"
    | "callerThreadId"
    | "createdAt"
    | "finishedAt"
    | "error"
    | "verdict"
  >,
) {
  // Keep full inputs and replies behind run_status so one large verdict cannot crowd out the inbox.
  const reason = (run.verdict?.summary || run.error || run.status).replace(/\s+/g, " ").trim();
  return {
    id: run.id,
    botId: run.botId,
    botName: run.botName,
    threadId: run.threadId,
    status: run.status,
    callerThreadId: run.callerThreadId,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    reason: reason.length > REASON_MAX_CHARS ? `${reason.slice(0, REASON_MAX_CHARS - 1)}…` : reason,
  };
}
