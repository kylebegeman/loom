import { ProjectId, RuntimeMode, ThreadId } from "@t3tools/contracts";
import {
  BotCreator,
  BotDefinition,
  BotsBatchInput,
  BotsRunInput,
  BotsRunPipelineInput,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";

const Caller = Schema.Struct({
  actor: BotCreator,
  threadId: Schema.NullOr(ThreadId),
  projectId: Schema.NullOr(ProjectId),
  runtimeMode: Schema.NullOr(RuntimeMode),
  requestScope: Schema.String,
});

export const TriggerDispatch = Schema.Struct({
  definition: BotDefinition,
  input: BotsRunInput,
  caller: Caller,
  job: Schema.Union([
    Schema.TaggedStruct("run", {}),
    Schema.TaggedStruct("skip", { reason: Schema.String }),
    Schema.TaggedStruct("batch", { input: BotsBatchInput }),
    Schema.TaggedStruct("pipeline", {
      input: BotsRunPipelineInput,
      version: Schema.Int,
      botVersions: Schema.Record(Schema.String, Schema.Int),
    }),
  ]),
});
export type TriggerDispatch = typeof TriggerDispatch.Type;
