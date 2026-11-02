import {
  DevEnvironmentError,
  type DevCompose,
  type DevContainers,
  type DevDatabaseAction,
  type DevDatabaseKind,
  type DevTarget,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ProcessRunner } from "../../processRunner.ts";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { DevEnvironmentService } from "./DevEnvironmentService.ts";
import {
  composeProject,
  databaseSpec,
  parseComposeStatus,
  validateComposeConfig,
} from "./containers.ts";
import { checkoutKey } from "./servers.ts";

const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"];
const OWNER_LABEL = "in.loom.dev.checkout";
const InspectContainer = Schema.Struct({
  Id: Schema.String,
  Config: Schema.Struct({ Labels: Schema.NullOr(Schema.Record(Schema.String, Schema.String)) }),
  State: Schema.Struct({ Status: Schema.String }),
  NetworkSettings: Schema.Struct({
    Ports: Schema.Record(
      Schema.String,
      Schema.NullOr(
        Schema.Array(Schema.Struct({ HostIp: Schema.String, HostPort: Schema.String })),
      ),
    ),
  }),
});
const Volume = Schema.Struct({
  Name: Schema.String,
  Labels: Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
});
const decodeContainers = Schema.decodeEffect(Schema.fromJsonString(Schema.Array(InspectContainer)));
const decodeVolumes = Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Volume)));
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
export class DevContainersService extends Context.Service<
  DevContainersService,
  {
    readonly list: (input: DevTarget) => Effect.Effect<DevContainers, DevEnvironmentError>;
    readonly compose: (input: DevCompose) => Effect.Effect<DevContainers, DevEnvironmentError>;
    readonly database: (
      input: DevDatabaseAction,
    ) => Effect.Effect<DevContainers, DevEnvironmentError>;
    readonly databaseUrl: (
      input: DevTarget & { kind: DevDatabaseKind },
    ) => Effect.Effect<{ url: string; hostNote: string }, DevEnvironmentError>;
  }
>()("t3/fork/browser-dev-tools/DevContainersService") {}
export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dev = yield* DevEnvironmentService;
  const runner = yield* ProcessRunner;
  const secrets = yield* ServerSecretStore;
  const gate = yield* Semaphore.make(1);
  const outputs = new Map<string, string>();
  const run = Effect.fn("DevContainers.docker")(function* (
    root: string,
    args: readonly string[],
    env?: NodeJS.ProcessEnv,
  ) {
    const result = yield* runner
      .run({
        command: "docker",
        args,
        cwd: root,
        timeout: "10 minutes",
        maxOutputBytes: 32768,
        outputMode: "truncate",
        ...(env ? { env } : {}),
      })
      .pipe(
        Effect.mapError(
          (cause) => new DevEnvironmentError({ reason: "docker-unavailable", cause }),
        ),
      );
    return { ...result, output: `${result.stdout}\n${result.stderr}`.trim().slice(-32768) };
  });
  const checked = Effect.fn("DevContainers.checked")(function* (
    root: string,
    args: readonly string[],
    env?: NodeJS.ProcessEnv,
    recordOutput = true,
  ) {
    const result = yield* run(root, args, env);
    if (recordOutput) outputs.set(root, result.output);
    if (result.code !== 0) return yield* new DevEnvironmentError({ reason: "command-failed" });
    return result;
  });
  const rootFor = Effect.fn("DevContainers.root")(function* (input: DevTarget) {
    return (yield* dev.snapshot(input)).root;
  });
  const composeFiles = Effect.fn("DevContainers.files")(function* (root: string) {
    return yield* Effect.filter(COMPOSE_FILES, (file) => fs.exists(`${root}/${file}`)).pipe(
      Effect.mapError(
        (cause) => new DevEnvironmentError({ reason: "checkout-unavailable", cause }),
      ),
    );
  });
  const inspect = Effect.fn("DevContainers.inspect")(function* (
    root: string,
    kind: DevDatabaseKind,
  ) {
    const spec = databaseSpec(root, kind);
    const found = yield* run(root, [
      "container",
      "ls",
      "--all",
      "--filter",
      `name=^/${spec.name}$`,
      "--format",
      "{{.ID}}",
    ]);
    if (found.code !== 0) return yield* new DevEnvironmentError({ reason: "command-failed" });
    if (!found.stdout.trim()) return null;
    const result = yield* checked(root, ["container", "inspect", spec.name], undefined, false);
    const containers = yield* decodeContainers(result.stdout).pipe(
      Effect.mapError((cause) => new DevEnvironmentError({ reason: "command-failed", cause })),
    );
    const container = containers[0];
    if (!container || container.Config.Labels?.[OWNER_LABEL] !== checkoutKey(root))
      return yield* new DevEnvironmentError({ reason: "ownership-conflict" });
    return container;
  });
  const volume = Effect.fn("DevContainers.volume")(function* (root: string, kind: DevDatabaseKind) {
    const spec = databaseSpec(root, kind);
    const found = yield* run(root, [
      "volume",
      "ls",
      "--filter",
      `name=^${spec.volume}$`,
      "--format",
      "{{.Name}}",
    ]);
    if (found.code !== 0) return yield* new DevEnvironmentError({ reason: "command-failed" });
    if (!found.stdout.trim()) return false;
    const result = yield* checked(root, ["volume", "inspect", spec.volume], undefined, false);
    const rows = yield* decodeVolumes(result.stdout).pipe(
      Effect.mapError((cause) => new DevEnvironmentError({ reason: "command-failed", cause })),
    );
    if (rows[0]?.Labels?.[OWNER_LABEL] !== checkoutKey(root))
      return yield* new DevEnvironmentError({ reason: "ownership-conflict" });
    return true;
  });
  const list = Effect.fn("DevContainers.list")(function* (
    input: DevTarget,
  ): Effect.fn.Return<DevContainers, DevEnvironmentError> {
    const root = yield* rootFor(input);
    const files = yield* composeFiles(root);
    const status = yield* run(root, ["info", "--format", "{{.ServerVersion}}"]).pipe(
      Effect.orElseSucceed(() => null),
    );
    const base = {
      root,
      composeFiles: files.map((path) => ({ path })),
      services: [],
      databases: [],
      output: outputs.get(root) ?? "",
    };
    if (!status || status.code !== 0) return { ...base, docker: false };
    const databases = yield* Effect.forEach(["postgres", "valkey"] as const, (kind) =>
      Effect.gen(function* () {
        const container = yield* inspect(root, kind);
        const hasData = yield* volume(root, kind);
        const spec = databaseSpec(root, kind);
        const binding = container?.NetworkSettings.Ports[`${spec.port}/tcp`]?.find(
          (entry) => entry.HostIp === "127.0.0.1",
        );
        return {
          kind,
          name: spec.name,
          state: container?.State.Status ?? "absent",
          port: binding ? Number(binding.HostPort) : null,
          hasData,
        };
      }),
    );
    const result = files.length
      ? yield* run(root, [
          "compose",
          "--project-name",
          composeProject(root),
          "--file",
          files[0]!,
          "ps",
          "--all",
          "--format",
          "json",
        ])
      : null;
    const services =
      result?.code === 0
        ? yield* Effect.try({
            try: () => parseComposeStatus(result.stdout),
            catch: (cause) => new DevEnvironmentError({ reason: "command-failed", cause }),
          })
        : [];
    return { ...base, docker: true, services, databases };
  });
  const compose = Effect.fn("DevContainers.compose")(function* (input: DevCompose) {
    const root = yield* rootFor(input);
    const files = yield* composeFiles(root);
    if (!files.includes(input.file))
      return yield* new DevEnvironmentError({ reason: "checkout-unavailable" });
    const args = ["compose", "--project-name", composeProject(root), "--file", input.file];
    const config = yield* checked(root, [...args, "config", "--format", "json"], undefined, false);
    const valid = yield* decodeJson(config.stdout).pipe(
      Effect.map((config) => validateComposeConfig(config, composeProject(root))),
      Effect.mapError((cause) => new DevEnvironmentError({ reason: "unsafe-compose", cause })),
    );
    if (!valid) return yield* new DevEnvironmentError({ reason: "unsafe-compose" });
    const operation =
      input.action === "up"
        ? ["up", "--detach"]
        : input.action === "logs"
          ? ["logs", "--no-color", "--tail", "200"]
          : [input.action];
    if (input.service) operation.push(input.service);
    yield* checked(root, [...args, ...operation]);
    const output = outputs.get(root) ?? "";
    return { ...(yield* list(input)), output };
  }, gate.withPermit);
  const database = Effect.fn("DevContainers.database")(function* (input: DevDatabaseAction) {
    const root = yield* rootFor(input);
    const spec = databaseSpec(root, input.kind);
    const container = yield* inspect(root, input.kind);
    const hasVolume = yield* volume(root, input.kind);
    if (input.action === "create") {
      const bytes =
        hasVolume || container
          ? yield* secrets.get(spec.secret).pipe(
              Effect.mapError(
                (cause) => new DevEnvironmentError({ reason: "secret-unavailable", cause }),
              ),
              Effect.flatMap((value) =>
                Effect.fromOption(
                  value,
                  () => new DevEnvironmentError({ reason: "secret-unavailable" }),
                ),
              ),
            )
          : yield* secrets
              .getOrCreateRandom(spec.secret, 24)
              .pipe(
                Effect.mapError(
                  (cause) => new DevEnvironmentError({ reason: "secret-unavailable", cause }),
                ),
              );
      const password = Buffer.from(bytes).toString("hex");
      if (!hasVolume)
        yield* checked(root, [
          "volume",
          "create",
          "--label",
          `${OWNER_LABEL}=${checkoutKey(root)}`,
          spec.volume,
        ]);
      if (!container) {
        const args = [
          "create",
          "--name",
          spec.name,
          "--label",
          `${OWNER_LABEL}=${checkoutKey(root)}`,
          "--publish",
          spec.publish,
          "--mount",
          `type=volume,src=${spec.volume},dst=${spec.mount}`,
        ];
        if (input.kind === "postgres")
          args.push(
            "--env",
            "POSTGRES_PASSWORD",
            "--env",
            "POSTGRES_USER=loom",
            "--env",
            "POSTGRES_DB=app",
            spec.image,
          );
        else
          args.push(
            "--env",
            "LOOM_DB_PASSWORD",
            spec.image,
            "sh",
            "-c",
            'exec valkey-server --appendonly yes --requirepass "$LOOM_DB_PASSWORD"',
          );
        yield* checked(
          root,
          args,
          input.kind === "postgres"
            ? { POSTGRES_PASSWORD: password }
            : { LOOM_DB_PASSWORD: password },
        );
      }
      if (container?.State.Status !== "running") yield* checked(root, ["start", spec.name]);
    } else if (input.action === "remove") {
      if (container) yield* checked(root, ["rm", "--force", spec.name]);
      if (input.deleteData && hasVolume) {
        yield* checked(root, ["volume", "rm", spec.volume]);
        yield* secrets
          .remove(spec.secret)
          .pipe(
            Effect.mapError(
              (cause) => new DevEnvironmentError({ reason: "secret-unavailable", cause }),
            ),
          );
      }
    } else {
      if (!container) return yield* new DevEnvironmentError({ reason: "database-not-found" });
      yield* checked(
        root,
        input.action === "logs" ? ["logs", "--tail", "200", spec.name] : [input.action, spec.name],
      );
    }
    const output = outputs.get(root) ?? "";
    return { ...(yield* list(input)), output };
  }, gate.withPermit);
  const databaseUrl = Effect.fn("DevContainers.databaseUrl")(function* (
    input: DevTarget & { kind: DevDatabaseKind },
  ) {
    const root = yield* rootFor(input);
    const container = yield* inspect(root, input.kind);
    const spec = databaseSpec(root, input.kind);
    const binding = container?.NetworkSettings.Ports[`${spec.port}/tcp`]?.find(
      (entry) => entry.HostIp === "127.0.0.1",
    );
    if (!binding || container?.State.Status !== "running")
      return yield* new DevEnvironmentError({ reason: "database-not-found" });
    const bytes = yield* secrets
      .get(spec.secret)
      .pipe(
        Effect.mapError(
          (cause) => new DevEnvironmentError({ reason: "secret-unavailable", cause }),
        ),
      );
    if (Option.isNone(bytes))
      return yield* new DevEnvironmentError({ reason: "secret-unavailable" });
    const password = Buffer.from(bytes.value).toString("hex");
    return {
      url:
        input.kind === "postgres"
          ? `postgresql://loom:${password}@127.0.0.1:${binding.HostPort}/app`
          : `redis://:${password}@127.0.0.1:${binding.HostPort}/0`,
      hostNote:
        "Reachable only on the execution computer. This URL contains a credential; keep it out of conversation messages and logs.",
    };
  });
  return DevContainersService.of({ list, compose, database, databaseUrl });
});
export const layer = Layer.effect(DevContainersService, make);
