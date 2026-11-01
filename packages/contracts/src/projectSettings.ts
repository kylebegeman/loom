import * as Schema from "effect/Schema";
import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProjectSettingsOverrides } from "./settings.ts";

export const ProjectSettingsKey = Schema.Literals(
  Object.keys(ProjectSettingsOverrides.fields) as [
    keyof typeof ProjectSettingsOverrides.fields,
    ...Array<keyof typeof ProjectSettingsOverrides.fields>,
  ],
);
export const ProjectSettingsSnapshot = Schema.Struct({
  projectId: ProjectId,
  revision: Schema.String,
  overrides: ProjectSettingsOverrides,
  effective: ProjectSettingsOverrides,
  sources: Schema.Record(Schema.String, Schema.Literals(["environment", "project", "t3.json"])),
});
export type ProjectSettingsSnapshot = typeof ProjectSettingsSnapshot.Type;
export const ProjectSettingsChange = Schema.Struct({
  projectId: ProjectId,
  expectedRevision: TrimmedNonEmptyString,
  settings: Schema.optionalKey(ProjectSettingsOverrides),
  inherit: Schema.optionalKey(Schema.Array(ProjectSettingsKey)),
});
export type ProjectSettingsChange = typeof ProjectSettingsChange.Type;
export class ProjectSettingsConflictError extends Schema.TaggedError<ProjectSettingsConflictError>()(
  "ProjectSettingsConflictError",
  {
    projectId: ProjectId,
  },
) {
  override get message() {
    return "Project settings changed. Read them again before saving.";
  }
}
