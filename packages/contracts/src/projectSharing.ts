import * as Schema from "effect/Schema";

// fork: library-projects
export const ProjectSharing = Schema.Struct({
  state: Schema.Literals(["shared", "pending", "unconnected"]),
  operationId: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
});
export type ProjectSharing = typeof ProjectSharing.Type;
