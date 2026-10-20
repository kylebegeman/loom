import { ThreadId } from "@t3tools/contracts";
import {
  VaultError,
  VaultHealthContextInput,
  VaultHealthRetainedInput,
  type VaultHealthRetainedPage,
  type VaultHealthContextPage,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultProfiles from "./VaultProfiles.ts";

export class VaultHealthContext extends Context.Service<
  VaultHealthContext,
  {
    readonly retained: (
      input: VaultHealthRetainedInput,
    ) => Effect.Effect<VaultHealthRetainedPage, VaultError>;
    readonly inspect: (
      input: VaultHealthContextInput,
    ) => Effect.Effect<VaultHealthContextPage, VaultError>;
  }
>()("t3/fork/vault/VaultHealthContext") {}
const isInput = Schema.is(VaultHealthContextInput);
const isRetainedInput = Schema.is(VaultHealthRetainedInput);
const PAGE_SIZE = 10;
const make = Effect.gen(function* () {
  const core = yield* VaultCore.VaultCore,
    access = yield* VaultAccess.VaultAccess,
    profiles = yield* VaultProfiles.VaultProfiles,
    projects = yield* ProjectStoreV2,
    threads = yield* ThreadManagementService;
  return VaultHealthContext.of({
    retained: Effect.fn("VaultHealthContext.retained")(function* (input) {
      if (!isRetainedInput(input)) return yield* new VaultError({ reason: "invalid-input" });
      if (!(yield* core.inspect(input.itemId)))
        return yield* new VaultError({ reason: "not-found" });
      const page = yield* profiles.pins({ projectId: input.projectId, cursor: input.cursor });
      return {
        itemId: input.itemId,
        projectId: input.projectId,
        checkedAt: yield* Clock.currentTimeMillis,
        inspectedSelections: page.items.length,
        coverage: {
          scope: "retained-page",
          externalConsumers: "not-discovered",
          providerCopies: "unknown",
          authorization: "not-evaluated",
        },
        unattributableSelections: page.items.filter((pin) => pin.resolution === null).length,
        nextCursor: page.nextCursor,
        items: page.items.flatMap((pin) => {
          const resolution = pin.resolution;
          if (!resolution) return [];
          const bindings = resolution.bindings
            .filter((binding) => binding.itemId === input.itemId)
            .map((binding) => ({ name: binding.name, itemVersion: binding.version }));
          return bindings.length === 0
            ? []
            : [
                {
                  id: pin.id,
                  threadId: pin.threadId,
                  runId: pin.runId,
                  version: pin.version,
                  runState: pin.runState,
                  canRetire: pin.canRetire,
                  profileId: resolution.profileId,
                  profileLabel: resolution.label,
                  profileVersion: resolution.profileVersion,
                  bindings,
                },
              ];
        }),
      };
    }),
    inspect: Effect.fn("VaultHealthContext.inspect")(function* (input) {
      if (!isInput(input)) return yield* new VaultError({ reason: "invalid-input" });
      if (!(yield* core.inspect(input.itemId)))
        return yield* new VaultError({ reason: "not-found" });
      const all = yield* projects
        .listShells()
        .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" })));
      const remaining = all
        .toSorted((a, b) => a.id.localeCompare(b.id))
        .filter((project) => input.cursor === null || project.id.localeCompare(input.cursor) > 0);
      const page = remaining.slice(0, PAGE_SIZE);
      const policy = yield* access.snapshot;
      const related = policy.grants.filter((grant) =>
        grant.definition.itemIds.includes(input.itemId),
      );
      const threadIds = [
        ...new Set(
          related.flatMap((grant) =>
            grant.definition.principal.kind === "thread" ? [grant.definition.principal.id] : [],
          ),
        ),
      ];
      const threadProjects = new Map(
        yield* Effect.forEach(
          threadIds,
          (id) =>
            threads.getThreadShell(ThreadId.make(id)).pipe(
              Effect.map(
                (thread) => [id, thread?.deletedAt === null ? thread.projectId : null] as const,
              ),
              Effect.mapError(() => new VaultError({ reason: "unavailable" })),
            ),
          { concurrency: 2 },
        ),
      );
      const projectIds = new Set<string>(all.map((project) => project.id));
      const grantProject = (grant: (typeof related)[number]) => {
        const principal = grant.definition.principal;
        return principal.kind === "project" ? principal.id : threadProjects.get(principal.id);
      };
      const unattributedGrants = related.filter((grant) => {
        const projectId = grantProject(grant);
        return projectId == null || !projectIds.has(projectId);
      }).length;
      const references = yield* Effect.forEach(
        page,
        (project) =>
          Effect.gen(function* () {
            const snapshot = yield* profiles.list(project.id);
            const matchedProfiles = snapshot.profiles.flatMap((profile) => {
              const requirements = profile.bindings
                .filter((binding) => binding.itemId === input.itemId)
                .map((binding) => binding.name);
              return requirements.length === 0
                ? []
                : [
                    {
                      id: profile.id,
                      label: profile.label,
                      state: profile.state,
                      isDefault: snapshot.activeProfileId === profile.id,
                      requirements,
                    },
                  ];
            });
            const grants = related
              .filter((grant) => grantProject(grant) === project.id)
              .map((grant) => ({
                id: grant.definition.id,
                label: grant.definition.label,
                principalKind: grant.definition.principal.kind,
                state: grant.state,
                expiresAt: grant.definition.expiresAt,
              }));
            return { id: project.id, title: project.title, profiles: matchedProfiles, grants };
          }),
        { concurrency: 2 },
      );
      return {
        itemId: input.itemId,
        checkedAt: yield* Clock.currentTimeMillis,
        inspectedProjects: page.length,
        coverage: {
          scope: "project-page",
          externalConsumers: "not-discovered",
          providerCopies: "unknown",
          authorization: "not-evaluated",
          unattributedGrants,
        },
        scannedProjects: page.map(({ id, title }) => ({ id, title })),
        nextCursor: remaining.length > PAGE_SIZE ? page.at(-1)!.id : null,
        projects: references.filter(
          (project) => project.profiles.length > 0 || project.grants.length > 0,
        ),
      };
    }),
  });
});
export const layer = Layer.effect(VaultHealthContext, make);
