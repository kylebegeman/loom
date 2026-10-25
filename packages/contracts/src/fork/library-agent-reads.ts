import * as Schema from "effect/Schema";
import { EnvironmentId, NonNegativeInt, ThreadId } from "../baseSchemas.ts";
import { LibraryId } from "./project-library.ts";

export const LibraryProjectsRead = Schema.Struct({
  includeArchived: Schema.optional(Schema.Boolean),
});
export const LibraryConversationsRead = Schema.Struct({
  projectId: Schema.optional(LibraryId),
  offset: Schema.optional(NonNegativeInt),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
});
export const LibraryConversationLookup = Schema.Struct({
  sourceEnvironmentId: EnvironmentId,
  threadId: ThreadId,
});
export const LibraryHistoryRead = Schema.Struct({
  id: LibraryId,
  offset: Schema.optional(NonNegativeInt),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
});
