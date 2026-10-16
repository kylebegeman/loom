import { CommandId, type Project, type ProjectId } from "@t3tools/contracts";
import {
  LibraryError,
  type LibraryProfileDifference,
  type LibraryProfileSettings,
  type LibraryProjectProfile,
} from "@t3tools/contracts/fork";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Option from "effect/Option";
import * as ProjectService from "../../project/ProjectService.ts";

type LocalSettings = Pick<Project, "scripts" | "defaultModelSelection">;
type ProfileSettings = Pick<LibraryProjectProfile, "scripts" | "defaultModelSelection">;

/** JSON with sorted keys, so equal settings compare equal whatever order they were written in. */
const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
        )
      : item,
  );

// An empty or absent profile value says nothing, so it never clears a local one.
const profileScripts = (profile: ProfileSettings) =>
  profile.scripts !== undefined && profile.scripts.length > 0 ? profile.scripts : null;

/** The profile values a local project lacks entirely. Values it already has are left alone. */
export const profileFill = (local: LocalSettings, profile: ProfileSettings) => {
  const scripts = profileScripts(profile);
  return {
    ...(scripts !== null && local.scripts.length === 0 ? { scripts } : {}),
    ...(profile.defaultModelSelection !== undefined && local.defaultModelSelection === null
      ? { defaultModelSelection: profile.defaultModelSelection }
      : {}),
  };
};

/** Local values that differ from the profile. Applying one replaces it after consent. */
export const profileDifferences = (
  local: LocalSettings,
  profile: ProfileSettings,
): LibraryProfileDifference[] => {
  const scripts = profileScripts(profile);
  const model = profile.defaultModelSelection;
  return [
    ...(scripts !== null && stableJson(local.scripts) !== stableJson(scripts)
      ? [{ field: "scripts" as const, local: local.scripts, profile: scripts }]
      : []),
    ...(model !== undefined && stableJson(local.defaultModelSelection) !== stableJson(model)
      ? [
          {
            field: "defaultModelSelection" as const,
            local: local.defaultModelSelection,
            profile: model,
          },
        ]
      : []),
  ];
};

/** Fills, compares and applies a profile's settings on a copy's local projects. */
export const makeProfileSettings = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const crypto = yield* Crypto.Crypto;
  const digest = (text: string) =>
    crypto
      .digest("SHA-256", new TextEncoder().encode(text))
      .pipe(Effect.map(Hex.encode), Effect.orDie);

  const update = (commandId: string, projectId: ProjectId, values: Partial<LocalSettings>) =>
    projects
      .update({ commandId: CommandId.make(commandId), projectId, ...values })
      .pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause })));

  const localProjects = Effect.fn("LibraryProfileSettings.localProjects")(function* (
    ids: ReadonlyArray<ProjectId>,
  ) {
    const found: Project[] = [];
    for (const id of new Set(ids)) {
      const project = yield* projects
        .getById(id)
        .pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause })));
      if (Option.isSome(project)) found.push(project.value);
    }
    return found;
  });

  const read = Effect.fn("LibraryProfileSettings.read")(function* (input: {
    readonly workingCopyId: string;
    readonly localProjectIds: ReadonlyArray<ProjectId>;
    readonly profile: ProfileSettings;
  }) {
    const compared = (yield* localProjects(input.localProjectIds)).map((project) => ({
      localProjectId: project.id,
      title: project.title,
      differences: profileDifferences(project, input.profile),
    }));
    const differing = compared.filter((project) => project.differences.length > 0);
    return {
      workingCopyId: input.workingCopyId,
      projects: differing,
      reviewToken: differing.length === 0 ? null : yield* digest(stableJson(differing)),
    } satisfies LibraryProfileSettings;
  });

  return {
    read,
    /** Applies profile values to empty local settings. Best effort: the diff offers the rest. */
    fillEmpty: Effect.fn("LibraryProfileSettings.fillEmpty")(function* (input: {
      readonly requestId: string;
      readonly localProjectIds: ReadonlyArray<ProjectId>;
      readonly profile: ProfileSettings;
    }) {
      for (const project of yield* localProjects(input.localProjectIds)) {
        const values = profileFill(project, input.profile);
        if (Object.keys(values).length === 0) continue;
        yield* update(`library-profile-fill:${input.requestId}:${project.id}`, project.id, values);
      }
    }),
    /** Replaces exactly the differences the person reviewed, named by `reviewToken`. */
    apply: Effect.fn("LibraryProfileSettings.apply")(function* (input: {
      readonly workingCopyId: string;
      readonly localProjectIds: ReadonlyArray<ProjectId>;
      readonly profile: ProfileSettings;
      readonly reviewToken: string;
    }) {
      const current = yield* read(input);
      if (current.reviewToken !== input.reviewToken)
        return yield* new LibraryError({ reason: "blocked" });
      for (const project of current.projects) {
        const values = Object.fromEntries(
          project.differences.map((difference) => [difference.field, difference.profile]),
        ) as Partial<LocalSettings>;
        // A fresh id each time: the same differences can come back and be applied again.
        const id = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
        yield* update(`library-profile-apply:${id}`, project.localProjectId, values);
      }
      return yield* read(input);
    }),
  };
});
