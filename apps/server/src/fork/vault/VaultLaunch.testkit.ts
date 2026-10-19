import { IsoDateTime } from "@t3tools/contracts";
import { VaultError } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import * as BrokerIdentity from "./BrokerIdentity.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as SshTransport from "./SshTransport.ts";
import * as VaultLaunch from "./VaultLaunch.ts";
import { sshFixture } from "./VaultSsh.testkit.ts";

export const memoryVault = Layer.sync(OpenBaoStore.OpenBaoStore, () => {
  const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  return OpenBaoStore.OpenBaoStore.of({
    status: Effect.succeed({
      backend: "openbao",
      state: "ready",
      origin: "https://vault.example.test",
    }),
    read: (path) => Effect.sync(() => records.get(path) ?? null),
    keys: (prefix) =>
      Effect.sync(() =>
        [...records.keys()]
          .filter((key) => key.startsWith(prefix + "/"))
          .map((key) => key.slice(prefix.length + 1)),
      ),
    write: (path, value, expected) =>
      Effect.suspend(() => {
        const version = records.get(path)?.version ?? 0;
        if (version !== expected) return Effect.fail(new VaultError({ reason: "conflict" }));
        records.set(path, { value, version: version + 1 });
        return Effect.succeed(version + 1);
      }),
  });
});
export const launchFixture = (
  transport: Layer.Layer<SshTransport.SshTransport>,
  githubAdapters?: Parameters<typeof sshFixture>[1],
) =>
  Effect.gen(function* () {
    const f = yield* sshFixture(transport, githubAdapters);
    const identity = BrokerIdentity.BrokerIdentity.of({
      read: () =>
        Effect.succeed({
          protocol: 1,
          ...f.machine,
          platform: "darwin",
          directory: "/private/broker",
        }),
      connection: () =>
        Effect.succeed({
          protocol: 1,
          origin: "http://localhost:1",
          environmentId: f.environmentId,
          machineId: f.machineId,
        }),
      connect: () => Effect.void,
      invitation: () => Effect.succeed(null),
    });
    const project = Layer.mock(ProjectStoreV2)({
      get: () =>
        Effect.succeed(
          Option.some({
            projectId: f.state.thread.projectId,
            title: "Disposable project",
            workspaceRoot: "/private/project",
            defaultModelSelection: null,
            defaultThreadEnvMode: null,
            autoPull: false,
            faviconPath: null,
            projectIcon: null,
            scripts: [],
            createdAt: IsoDateTime.make("2026-10-18T00:00:00Z"),
            updatedAt: IsoDateTime.make("2026-10-18T00:00:00Z"),
            deletedAt: null,
          }),
        ),
    });
    const launch = yield* VaultLaunch.VaultLaunch.pipe(
      Effect.provide(
        VaultLaunch.layer.pipe(
          Layer.provide(Layer.merge(project, Layer.succeedContext(f.context))),
        ),
      ),
      Effect.provideService(BrokerIdentity.BrokerIdentity, identity),
      Effect.provideService(HostProcess.Environment, {
        LOOM_VAULT_EXECUTION_BROKER_DIR: "/private/broker",
      }),
    );
    const host = yield* f.sshKeys.create;
    const key = yield* f.ssh.generate(
      {
        id: f.itemId,
        operationId: yield* f.id,
        label: "Launch SSH",
        target: { hostname: "example.test", username: "git", port: 22, hostKey: host.publicKey },
      },
      "admin",
      Effect.void,
    );
    return { ...f, launch, identity, project, key };
  });
