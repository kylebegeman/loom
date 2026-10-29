import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { defaultProjectProfile, type AgentToolFamilies } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { HttpClientResponse } from "effect/http";
import type { LibraryConnection } from "../project-library/LibraryConnection.ts";
import { ProjectionStoreV2 } from "../../orchestration-v2/ProjectionStore.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import { ProjectProfileService } from "../project-profiles/ProjectProfileService.ts";
import { LibraryWorkspaceStore } from "../project-library/LibraryWorkspaceStore.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { SitesService } from "../sites/SitesService.ts";
import { hardwareMarkers, layer, SessionToolPolicy } from "./SessionToolPolicy.ts";

const projectId = ProjectId.make("local-project");
const threadId = ThreadId.make("thread");

it.effect.each([
  ["board.kicad_pro", "{}", true],
  ["board.kicad_pcb", "", true],
  ["case.scad", "cube(1);", true],
  ["tscircuit.config.ts", "export default {}", true],
  ["package.json", '{"devDependencies":{"tscircuit":"1"}}', true],
  ["package.json", '{"dependencies":{"react":"19"}}', false],
  ["package.json", "not json", false],
] as const)("recognizes only hardware markers in %s", ([name, source, expected]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(`${root}/${name}`, source);
    expect(yield* hardwareMarkers(root)).toBe(expected);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "reads fresh overrides while caching only hardware evidence and using Library project IDs",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      let preferences: AgentToolFamilies | undefined;
      let siteReads = 0;
      let libraryConnection: LibraryConnection = { kind: "authority" };
      const program = Effect.gen(function* () {
        const policy = yield* SessionToolPolicy;
        expect([...(yield* policy.forThread(threadId))]).toEqual(["reach", "sites"]);
        yield* fs.writeFileString(`${root}/board.kicad_pro`, "{}");
        expect([...(yield* policy.forThread(threadId))]).toEqual(["reach", "sites"]);
        yield* TestClock.adjust("31 seconds");
        expect([...(yield* policy.forThread(threadId))]).toEqual(["hardware", "reach", "sites"]);
        preferences = { hardware: "never", reach: "never", sites: "never" };
        const before = siteReads;
        expect([...(yield* policy.forThread(threadId))]).toEqual([]);
        expect(siteReads).toBe(before);
        preferences = { hardware: "always", reach: "always", sites: "always" };
        expect([...(yield* policy.forThread(threadId))]).toEqual(["hardware", "reach", "sites"]);
        expect(siteReads).toBe(before);
        preferences = undefined;
        let status = 200;
        libraryConnection = {
          kind: "remote",
          credential: null,
          origin: "https://library.example.test",
          endpoint: (path) => `https://library.example.test${path}`,
          send: (request) => {
            expect(request.url).toBe("https://library.example.test/api/loom/mcp/tool-context");
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response('{"reach":false,"sites":true}', { status }),
              ),
            );
          },
        };
        expect([...(yield* policy.forThread(threadId))]).toEqual(["hardware", "sites"]);
        status = 503;
        expect([...(yield* policy.forThread(threadId))]).toEqual(["hardware"]);
      });
      const dependencies = Layer.mergeAll(
        Layer.mock(ProjectionStoreV2)({
          getThread: () => Effect.succeed({ projectId, worktreePath: root } as never),
        }),
        Layer.mock(ProjectStoreV2)({
          get: () => Effect.succeedSome({ workspaceRoot: "/unused" } as never),
        }),
        Layer.mock(ProjectProfileService)({
          get: () =>
            Effect.succeed({
              ...defaultProjectProfile(projectId),
              ...(preferences ? { agentToolFamilies: preferences } : {}),
            }),
        }),
        Layer.mock(LibraryWorkspaceStore)({
          getBoundProject: () => Effect.succeed({ id: "library-project" } as never),
        }),
        Layer.mock(LibraryConnectionService)({ current: Effect.sync(() => libraryConnection) }),
        Layer.mock(DirectoryService)({}),
        Layer.mock(SitesService)({
          snapshot: Effect.sync(() => {
            siteReads++;
            return {
              configured: true,
              managementConfigured: false,
              snapshot: { sites: [{ projectIds: ["library-project"] }] } as never,
            };
          }),
        }),
        Layer.succeed(HostProcess.Environment, {
          LOOM_LIBRARY_AUTHORITY: "true",
          LOOM_REACH_ZONE: "reach.example.test",
        }),
      );
      yield* program.pipe(Effect.provide(layer.pipe(Layer.provide(dependencies))));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
