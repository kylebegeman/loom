import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { ProcessRunner, type ProcessRunOutput } from "../../processRunner.ts";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { DevEnvironmentService } from "./DevEnvironmentService.ts";
import { make } from "./DevContainersService.ts";
import { checkoutKey } from "./servers.ts";
import { databaseSpec } from "./containers.ts";
const target = { threadId: ThreadId.make("thread") };
const output = (stdout = "", code = 0): ProcessRunOutput => ({
  stdout,
  stderr: "",
  code: ChildProcessSpawner.ExitCode(code),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped();
  yield* fs.writeFileString(`${root}/compose.yaml`, "services: {}\n");
  let exists = false,
    data = false,
    state = "created",
    owner = checkoutKey(root),
    external = false,
    missingSecret = false,
    dockerAvailable = true;
  const calls: string[][] = [];
  const mutations: string[] = [];
  const secret = new Uint8Array([1, 2, 3]);
  const service = yield* make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(DevEnvironmentService, {
          snapshot: () => Effect.succeed({ root, candidates: [], runs: [] }),
          watch: () => {
            throw new Error("Unexpected watch");
          },
          start: () => {
            throw new Error("Unexpected start");
          },
          control: () => {
            throw new Error("Unexpected control");
          },
        }),
        Layer.succeed(ProcessRunner, {
          run: (input) =>
            Effect.sync(() => {
              calls.push([...input.args]);
              const args = input.args;
              if (args[0] === "info") return output("29.0.0", dockerAvailable ? 0 : 1);
              if (args[0] === "container" && args[1] === "ls")
                return output(exists && String(args).includes("postgres") ? "owned" : "");
              if (args[0] === "volume" && args[1] === "ls")
                return output(data && String(args).includes("postgres") ? "owned" : "");
              if (args[0] === "container" && args[1] === "inspect")
                return output(
                  JSON.stringify([
                    {
                      Id: "container",
                      Config: {
                        Labels: { "in.loom.dev.checkout": owner },
                        Env: ["POSTGRES_PASSWORD=never-return-this"],
                      },
                      State: { Status: state },
                      NetworkSettings: {
                        Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "30001" }] },
                      },
                    },
                  ]),
                );
              if (args[0] === "volume" && args[1] === "inspect")
                return output(
                  JSON.stringify([
                    {
                      Name: databaseSpec(root, "postgres").volume,
                      Labels: { "in.loom.dev.checkout": owner },
                    },
                  ]),
                );
              if (args[0] === "volume" && args[1] === "create") {
                data = true;
                mutations.push("volume-create");
                return output("volume");
              }
              if (args[0] === "volume" && args[1] === "rm") {
                data = false;
                mutations.push("volume-remove");
                return output();
              }
              if (args[0] === "create") {
                exists = true;
                mutations.push("create");
                expect(args).not.toContain("010203");
                expect(input.env?.POSTGRES_PASSWORD).toBe("010203");
                return output("container");
              }
              if (args[0] === "start") {
                state = "running";
                mutations.push("start");
                return output();
              }
              if (args[0] === "stop") {
                state = "exited";
                return output();
              }
              if (args[0] === "rm") {
                exists = false;
                mutations.push("remove");
                return output();
              }
              if (args.includes("config"))
                return output(
                  JSON.stringify({
                    services: { app: { image: "example" } },
                    volumes: external ? { data: { external: true } } : {},
                    secrets: { secret: { content: "never-return-this" } },
                  }),
                );
              if (args.includes("ps")) return output("[]");
              if (args.includes("up")) {
                mutations.push("compose-up");
                return output("started");
              }
              throw new Error(`Unexpected Docker command ${args[0]}`);
            }),
        }),
        Layer.succeed(ServerSecretStore, {
          get: () => Effect.succeed(missingSecret ? Option.none() : Option.some(secret)),
          getOrCreateRandom: () => Effect.succeed(secret),
          set: () => Effect.void,
          create: () => Effect.void,
          remove: () => Effect.void,
        }),
      ),
    ),
  );
  return {
    service,
    mutations,
    calls,
    stopDocker: () => {
      dockerAvailable = false;
    },
    loseSecret: () => {
      missingSecret = true;
    },
    wrongOwner: () => {
      owner = "another-checkout";
    },
    external: () => {
      external = true;
    },
  };
});
describe("managed development dependencies", () => {
  it.effect(
    "reuses databases, keeps data on removal, restores it, protects ownership and omits credentials",
    () =>
      Effect.gen(function* () {
        const { service, mutations, wrongOwner, loseSecret } = yield* fixture;
        const input = { ...target, kind: "postgres" as const, action: "create" as const };
        const created = yield* service.database(input);
        expect(created.databases.find((db) => db.kind === "postgres")?.state).toBe("running");
        expect(JSON.stringify(created)).not.toContain("never-return-this");
        expect((yield* service.database(input)).databases[0]?.port).toBe(30001);
        expect(mutations.filter((action) => action === "create")).toHaveLength(1);
        expect((yield* service.databaseUrl({ ...target, kind: "postgres" })).url).toBe(
          "postgresql://loom:010203@127.0.0.1:30001/app",
        );
        const removed = yield* service.database({ ...input, action: "remove" });
        expect(removed.databases[0]?.hasData).toBe(true);
        yield* service.database(input);
        expect(mutations.filter((action) => action === "volume-create")).toHaveLength(1);
        yield* service.database({ ...input, action: "remove" });
        loseSecret();
        expect((yield* service.database(input).pipe(Effect.flip)).reason).toBe(
          "secret-unavailable",
        );
        expect(mutations.filter((action) => action === "create")).toHaveLength(2);
        wrongOwner();
        expect(
          (yield* service
            .database({ ...input, action: "remove", deleteData: true })
            .pipe(Effect.flip)).reason,
        ).toBe("ownership-conflict");
        expect(mutations).not.toContain("volume-remove");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "isolates Compose commands and refuses external resources before starting the stack",
    () =>
      Effect.gen(function* () {
        const { service, mutations, calls, external, stopDocker } = yield* fixture;
        const started = yield* service.compose({ ...target, file: "compose.yaml", action: "up" });
        expect(started.output).toBe("started");
        expect(JSON.stringify(started)).not.toContain("never-return-this");
        expect(calls.find((args) => args.includes("up"))).toContain("--project-name");
        external();
        expect(
          (yield* service
            .compose({ ...target, file: "compose.yaml", action: "up" })
            .pipe(Effect.flip)).reason,
        ).toBe("unsafe-compose");
        expect(mutations.filter((action) => action === "compose-up")).toHaveLength(1);
        expect(
          (yield* service
            .compose({ ...target, file: "../compose.yaml", action: "down" })
            .pipe(Effect.flip)).reason,
        ).toBe("checkout-unavailable");
        stopDocker();
        expect((yield* service.list(target)).docker).toBe(false);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
