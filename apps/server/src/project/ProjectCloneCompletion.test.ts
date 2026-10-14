// fork: project-preparation - Clone completion keeps current metadata in connected clients.
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, ProjectId, type RepositoryIdentity } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../config.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { makeProjectCloneCompletion } from "../ws.ts";
import * as ProjectEnrichment from "./ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "./ProjectFaviconResolver.ts";
import * as ProjectService from "./ProjectService.ts";
import * as RepositoryIdentityResolver from "./RepositoryIdentityResolver.ts";

it.effect(
  "publishes the newly cloned repository to existing readers after an empty folder was cached",
  () =>
    Effect.gen(function* () {
      const workspaceRoot = "/workspace/new-clone";
      const projectId = ProjectId.make("project:post-clone-enrichment");
      const repository: RepositoryIdentity = {
        rootPath: workspaceRoot,
        canonicalKey: "github.com/kyle/new-clone",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/kyle/new-clone.git",
        },
      };
      const cloned = yield* Ref.make(false);
      const metadata = Layer.merge(
        Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
          resolve: () => Ref.get(cloned).pipe(Effect.map((ready) => (ready ? repository : null))),
        }),
        Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
          resolvePath: () => Effect.succeed(null),
        }),
      );
      const testLayer = RuntimeLayer.layerProjectService.pipe(
        Layer.provideMerge(ProjectEnrichment.layer),
        Layer.provideMerge(
          Layer.succeed(WorkspacePaths.WorkspacePaths, {
            normalizeWorkspaceRoot: (root) => Effect.succeed(root),
            resolveRelativePathWithinRoot: ({ workspaceRoot, relativePath }) =>
              Effect.succeed({ absolutePath: `${workspaceRoot}/${relativePath}`, relativePath }),
          }),
        ),
        Layer.provideMerge(metadata),
        Layer.provideMerge(SqlitePersistence.layerMemory),
        Layer.provideMerge(ServerSettings.layerTest()),
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "clone-enrichment-test-" })),
        Layer.provide(NodeServices.layer),
      );
      yield* Effect.gen(function* () {
        const service = yield* ProjectService.ProjectService;
        const enrichment = yield* ProjectEnrichment.ProjectEnrichmentService;
        const changes = yield* enrichment.subscribeChanges;
        const completeClone = yield* makeProjectCloneCompletion;
        yield* service.create({
          commandId: CommandId.make("project:post-clone:create"),
          projectId,
          title: "New clone",
          workspaceRoot,
        });
        const beforeClone = yield* PubSub.take(changes);
        assert.equal(beforeClone.workspaceRoot, workspaceRoot);
        assert.isTrue(beforeClone.repositoryIdentityResolved);
        assert.isNull(beforeClone.enrichment.repositoryIdentity);
        assert.isNull(Option.getOrThrow(yield* service.getShell(projectId)).repositoryIdentity);

        // Git finished in the same folder while the client's metadata subscription stayed open.
        yield* Ref.set(cloned, true);
        yield* completeClone({ projectId, workspaceRoot });
        const refreshed = yield* enrichment.peek(workspaceRoot);
        // Fail immediately for cached resolved-null, rather than waiting for a missing event.
        assert.isTrue(
          !refreshed.repositoryIdentityResolved || refreshed.repositoryIdentity !== null,
        );
        const afterClone = yield* PubSub.take(changes);
        assert.equal(afterClone.workspaceRoot, workspaceRoot);
        assert.deepEqual(afterClone.enrichment.repositoryIdentity, repository);
        assert.isTrue(afterClone.repositoryIdentityResolved);
        assert.deepEqual(
          Option.getOrThrow(yield* service.getShell(projectId)).repositoryIdentity,
          repository,
        );
      }).pipe(Effect.provide(testLayer));
    }).pipe(Effect.scoped),
);
