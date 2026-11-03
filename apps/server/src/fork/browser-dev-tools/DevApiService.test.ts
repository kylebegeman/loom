import { expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ProcessRunner from "../../processRunner.ts";
import * as Redacted from "effect/Redacted";
import { VaultError, type DevHttpRequest, type VaultItemSummary } from "@t3tools/contracts/fork";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as VaultCore from "../vault/VaultCore.ts";
import * as VaultAccess from "../vault/VaultAccess.ts";
import * as Credentials from "./DevApiCredentials.ts";
import * as Config from "../../config.ts";
import { DevEnvironmentService } from "./DevEnvironmentService.ts";
import { DevRequestsService } from "./DevRequestsService.ts";
import { make } from "./DevApiService.ts";
const target = { threadId: ThreadId.make("api-fixture") };
const collection = (
  pre = 'pw.env.set("prepared", "yes");',
  post = 'pw.env.set("token", pw.response.body.token); pw.env.set("cookie", pw.response.headers.find(h => h.key === "set-cookie").value); pw.test("created", () => pw.expect(pw.response.status).toBe(201));',
) =>
  JSON.stringify([
    {
      v: 12,
      name: "API",
      folders: [],
      requests: [
        {
          v: "17",
          name: "Login",
          method: "POST",
          endpoint: "<<origin>>/login",
          body: { contentType: "application/json", body: '{"prepared":"<<prepared>>"}' },
          headers: [],
          params: [],
          auth: { authType: "bearer", authActive: true, token: "<<token>>" },
          preRequestScript: pre,
          testScript: post,
          requestVariables: [{ key: "requestOnly", value: "local" }],
          responses: {},
        },
      ],
    },
  ]);
const files = (pre?: string, post?: string) => [
  { name: "collection.json", content: collection(pre, post) },
  {
    name: "local.environment.json",
    content: JSON.stringify({
      v: 2,
      name: "Local",
      variables: [
        { key: "origin", initialValue: "http://localhost", currentValue: "", secret: false },
        { key: "token", initialValue: "", currentValue: "", secret: true },
      ],
    }),
  },
];
const unused = () => {
  throw new Error("Unexpected fixture call");
};
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped();
  const calls: string[] = [];
  const observation = { effect: Effect.void, echo: false, request: null as DevHttpRequest | null };
  const credential = { allowed: true, releases: 0, value: "fixture-private-api-key" };
  const item: VaultItemSummary = {
    id: "a".repeat(32),
    label: "Fixture key",
    kind: "secret",
    state: "active",
    version: 1,
    createdAt: "2026-11-02T00:00:00Z",
    updatedAt: "2026-11-02T00:00:00Z",
  };
  const credentialDeps = Layer.mergeAll(
    Layer.succeed(ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("fixture-computer")),
    }),
    Layer.mock(VaultCore.VaultCore)({ inspect: () => Effect.succeed(item) }),
    Layer.mock(VaultAccess.VaultAccess)({
      require: () =>
        Effect.suspend(() =>
          credential.allowed ? Effect.void : Effect.fail(new VaultError({ reason: "denied" })),
        ),
      reveal: () =>
        Effect.sync(() => {
          credential.releases++;
          return { item, value: Redacted.make(credential.value) };
        }),
    }),
  );
  const dev = Layer.succeed(DevEnvironmentService, {
    snapshot: () => Effect.succeed({ root, candidates: [], runs: [] }),
    watch: unused,
    start: unused,
    control: unused,
  });
  const requests = Layer.succeed(DevRequestsService, {
    send: unused,
    history: unused,
    baseline: unused,
    clear: unused,
    sendForWorkflow: (input) =>
      Effect.gen(function* () {
        yield* observation.effect;
        calls.push(input.request.headers.authorization ?? "");
        observation.request = input.request;
        return {
          id: input.requestId,
          request: input.request,
          startedAt: "2026-11-02T00:00:00Z",
          durationMs: 1,
          status: 201,
          headers: { "set-cookie": "fixture-cookie" },
          body: observation.echo
            ? JSON.stringify({ token: credential.value })
            : '{"token":"fixture-captured"}',
          byteLength: 28,
          truncated: false,
          binary: false,
          error: null,
        };
      }),
  });
  const deps = Layer.mergeAll(
    dev,
    requests,
    ProcessRunner.layer,
    Credentials.layer.pipe(Layer.provide(credentialDeps)),
  );
  const api = yield* make.pipe(Effect.provide(deps));
  return {
    api,
    root,
    calls,
    observation,
    credential,
    item,
    reload: make.pipe(Effect.provide(deps)),
  };
});
const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.scoped,
    Effect.provide(
      Config.layerTest(process.cwd(), { prefix: "api-workspace-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );
it.live(
  "imports native files idempotently and runs explicit environments with captures, inherited scripts and durable retry receipts",
  () =>
    Effect.gen(function* () {
      const { api, calls, reload, observation } = yield* fixture;
      const workspace = yield* api.import({ ...target, name: "Fixture", files: files() });
      expect((yield* api.import({ ...target, name: "Fixture", files: files() })).workspace.id).toBe(
        workspace.workspace.id,
      );
      expect(yield* api.list(target)).toHaveLength(1);
      const scope = {
        ...target,
        workspaceId: workspace.workspace.id,
        source: { kind: "json" as const, id: workspace.environments[0]!.id },
      };
      const initial = yield* api.environment(scope);
      const filled = initial.variables.map((v) =>
        v.key === "token" ? { ...v, value: "fixture-token" } : v,
      );
      const saved = yield* api.saveEnvironment({
        ...scope,
        expectedRevision: initial.revision,
        variables: filled,
      });
      expect(
        (yield* api
          .saveEnvironment({ ...scope, expectedRevision: initial.revision, variables: filled })
          .pipe(Effect.flip)).reason,
      ).toBe("revision-conflict");
      observation.effect = api.environment(scope).pipe(
        Effect.tap((value) =>
          Effect.sync(() =>
            expect(value.variables.find((v) => v.key === "prepared")?.value).toBe("yes"),
          ),
        ),
        Effect.asVoid,
        Effect.orDie,
      );
      const input = {
        ...scope,
        expectedRevision: workspace.revision,
        environmentRevision: saved.revision,
        requestKey: workspace.requests[0]!.id,
        requestId: "run-one",
      };
      const result = yield* api.run(input);
      expect(result.exchange.status).toBe(201);
      expect(result.exchange.headers["set-cookie"]).toBe("[redacted]");
      expect(result.checks).toEqual([{ name: "created", passed: true }]);
      expect(calls).toEqual(["Bearer fixture-token"]);
      const after = yield* api.environment(scope);
      expect(after.variables.find((v) => v.key === "token")?.value).toBe("fixture-captured");
      expect(after.variables.find((v) => v.key === "cookie")?.value).toBe("fixture-cookie");
      expect(after.variables.some((v) => v.key === "requestOnly")).toBe(false);
      const restored = yield* reload;
      expect(yield* restored.run(input)).toEqual(result);
      expect(calls).toHaveLength(1);
      expect((yield* api.run({ ...input, requestKey: "changed" }).pipe(Effect.flip)).reason).toBe(
        "request-conflict",
      );
      expect((yield* api.run({ ...input, requestId: "stale" }).pipe(Effect.flip)).reason).toBe(
        "revision-conflict",
      );
      yield* api.remove(scope);
      expect(yield* api.list(target)).toEqual([]);
    }).pipe(provide),
);
it.live(
  "prevents dispatch after a failed preparation and retains scripted credential invalidation",
  () =>
    Effect.gen(function* () {
      const { api, calls } = yield* fixture;
      const workspace = yield* api.import({
        ...target,
        name: "Guard",
        files: files('pw.env.set("token", ""); throw Error("stop");'),
      });
      const scope = {
        ...target,
        workspaceId: workspace.workspace.id,
        source: { kind: "json" as const, id: workspace.environments[0]!.id },
      };
      const initial = yield* api.environment(scope);
      const env = yield* api.saveEnvironment({
        ...scope,
        expectedRevision: initial.revision,
        patch: true,
        variables: [{ key: "token", value: "fixture-token", secret: true }],
      });
      expect(env.variables.find((v) => v.key === "origin")?.value).toBe("http://localhost");
      const input = {
        ...scope,
        expectedRevision: workspace.revision,
        environmentRevision: env.revision,
        requestKey: workspace.requests[0]!.id,
        requestId: "guard",
      };
      expect((yield* api.run(input).pipe(Effect.flip)).reason).toBe("script-failed");
      expect(calls).toEqual([]);
      expect((yield* api.environment(scope)).variables.find((v) => v.key === "token")?.value).toBe(
        "",
      );
      expect((yield* api.run(input).pipe(Effect.flip)).reason).toBe("script-failed");
      const denied = yield* api.import({
        ...target,
        name: "No ambient filesystem",
        files: files(
          'const process = pw.env.get.constructor("return process")(); process.getBuiltinModule("fs").readFileSync("/etc/passwd");',
        ),
      });
      const deniedScope = {
        ...target,
        workspaceId: denied.workspace.id,
        source: { kind: "json" as const, id: denied.environments[0]!.id },
      };
      const deniedEnv = yield* api.environment(deniedScope);
      expect(
        (yield* api
          .run({
            ...deniedScope,
            expectedRevision: denied.revision,
            environmentRevision: deniedEnv.revision,
            requestKey: denied.requests[0]!.id,
            requestId: "denied",
          })
          .pipe(Effect.flip)).reason,
      ).toBe("script-failed");
      expect(calls).toEqual([]);
    }).pipe(provide),
);
it.live(
  "uses only the selected dotenv file, preserves its contents and refuses stale saves and symlink escapes",
  () =>
    Effect.gen(function* () {
      const { api, root, calls, observation } = yield* fixture;
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(
        `${root}/.env`,
        "# preserve this comment\norigin=http://localhost\ntoken=dotenv-token\nUNCHANGED=yes\n",
      );
      const workspace = yield* api.import({ ...target, name: "Dotenv", files: files() });
      const scope = {
        ...target,
        workspaceId: workspace.workspace.id,
        source: { kind: "dotenv" as const, path: ".env" },
      };
      const env = yield* api.environment(scope);
      yield* api.run({
        ...scope,
        expectedRevision: workspace.revision,
        environmentRevision: env.revision,
        requestKey: workspace.requests[0]!.id,
        requestId: "dotenv",
      });
      expect(calls).toEqual(["Bearer dotenv-token"]);
      expect(yield* fs.readFileString(`${root}/.env`)).toContain("token=dotenv-token");
      const overlay = yield* api.environment(scope);
      expect(overlay.variables.find((v) => v.key === "token")?.value).toBe("fixture-captured");
      yield* api.saveEnvironment({
        ...scope,
        expectedRevision: overlay.revision,
        variables: overlay.variables,
      });
      const text = yield* fs.readFileString(`${root}/.env`);
      expect(text).toContain(
        "# preserve this comment\norigin=http://localhost\ntoken='fixture-captured'\nUNCHANGED=yes\n",
      );
      expect(text).toContain("token='fixture-captured'");
      expect(
        (yield* api
          .saveEnvironment({
            ...scope,
            expectedRevision: overlay.revision,
            variables: overlay.variables,
          })
          .pipe(Effect.flip)).reason,
      ).toBe("revision-conflict");
      const latest = yield* api.environment(scope);
      observation.effect = fs
        .writeFileString(`${root}/.env`, "origin=http://localhost\ntoken=concurrent-value\n")
        .pipe(Effect.orDie);
      const concurrent = yield* api.run({
        ...scope,
        expectedRevision: workspace.revision,
        environmentRevision: latest.revision,
        requestKey: workspace.requests[0]!.id,
        requestId: "concurrent",
      });
      expect(concurrent.environmentUpdated).toBe(false);
      expect((yield* api.environment(scope)).variables.find((v) => v.key === "token")?.value).toBe(
        "concurrent-value",
      );
      const outside = yield* fs.makeTempDirectoryScoped();
      yield* fs.writeFileString(`${outside}/.env`, "PRIVATE=outside");
      yield* fs.symlink(`${outside}/.env`, `${root}/.env.escape`);
      expect(
        (yield* api
          .environment({ ...scope, source: { kind: "dotenv", path: ".env.escape" } })
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-path");
    }).pipe(provide),
);

it.live(
  "saves exact request edits with revision conflicts and exports current portable environments without secrets",
  () =>
    Effect.gen(function* () {
      const { api } = yield* fixture;
      const workspace = yield* api.import({ ...target, name: "Editable", files: files() });
      const scope = { ...target, workspaceId: workspace.workspace.id };
      const key = workspace.requests[0]!.id;
      const read = yield* api.read({ ...scope, requestKey: key });
      const source = JSON.parse(read.selected!.sourceJson);
      const edited = {
        ...source,
        name: "Edited login",
        endpoint: "<<origin>>/v2/login",
        extension: { keep: true },
      };
      const saved = yield* api.saveRequest({
        ...scope,
        requestKey: key,
        expectedRevision: read.revision,
        sourceJson: JSON.stringify(edited),
      });
      expect(saved.requests[0]!.name).toBe("Edited login");
      expect(saved.selected!.endpoint).toBe("<<origin>>/v2/login");
      expect(
        (yield* api
          .saveRequest({
            ...scope,
            requestKey: key,
            expectedRevision: read.revision,
            sourceJson: read.selected!.sourceJson,
          })
          .pipe(Effect.flip)).reason,
      ).toBe("revision-conflict");
      const envScope = {
        ...scope,
        source: { kind: "json" as const, id: workspace.environments[0]!.id },
      };
      const environment = yield* api.environment(envScope);
      yield* api.saveEnvironment({
        ...envScope,
        expectedRevision: environment.revision,
        variables: [
          { key: "origin", value: "https://staging.example.test", secret: false },
          { key: "token", value: "private-export-fixture", secret: true },
        ],
      });
      const exported = yield* api.export(scope);
      const collectionExport = JSON.parse(
        exported.files.find((f) => f.name === "collection.json")!.content,
      );
      expect(collectionExport[0].requests[0].extension).toEqual({ keep: true });
      expect(collectionExport[0].requests[0].name).toBe("Edited login");
      const envExport = JSON.parse(
        exported.files.find((f) => f.name === "local.environment.json")!.content,
      );
      expect(
        envExport.variables.find((v: { key: string }) => v.key === "origin").initialValue,
      ).toBe("https://staging.example.test");
      expect(JSON.stringify(exported)).not.toContain("private-export-fixture");
    }).pipe(provide),
);

it.live(
  "uses Vault references privately for the exact origin and refuses missing caller authority or revoked access before dispatch",
  () =>
    Effect.gen(function* () {
      const { api, root, calls, observation, credential, item } = yield* fixture;
      observation.echo = true;
      const workspace = yield* api.import({
        ...target,
        name: "Vault",
        files: files(
          undefined,
          'pw.env.set("copied", pw.response.body.token); pw.test(pw.response.body.token, () => pw.expect(pw.response.status).toBe(201));',
        ),
      });
      const scope = {
        ...target,
        workspaceId: workspace.workspace.id,
        source: { kind: "json" as const, id: workspace.environments[0]!.id },
      };
      const initial = yield* api.environment(scope);
      const bound = yield* api.saveEnvironment({
        ...scope,
        expectedRevision: initial.revision,
        variables: initial.variables.map((v) =>
          v.key === "token"
            ? {
                ...v,
                value: "must-be-cleared",
                vault: {
                  environmentId: EnvironmentId.make("fixture-computer"),
                  itemId: item.id,
                  label: item.label,
                  origin: "http://localhost",
                  version: null,
                },
              }
            : v,
        ),
      });
      expect(bound.variables.find((v) => v.key === "token")?.value).toBe("");
      const input = {
        ...scope,
        expectedRevision: workspace.revision,
        environmentRevision: bound.revision,
        requestKey: workspace.requests[0]!.id,
        requestId: "private",
        requestOverride: JSON.stringify({
          ...JSON.parse(collection())[0].requests[0],
          body: {
            contentType: "multipart/form-data",
            body: [
              { key: "credential", value: "<<token>>", active: true, isFile: false },
              { key: "attachment", value: [], active: true, isFile: true },
            ],
          },
        }),
        uploads: [
          {
            fieldIndex: 1,
            fileName: "note.txt",
            contentType: "text/plain",
            base64: Buffer.from("fixture file").toString("base64"),
          },
        ],
      };
      expect((yield* api.run({ ...input, requestId: "no-caller" }).pipe(Effect.flip)).reason).toBe(
        "vault-required",
      );
      const caller = { kind: "agent" as const, threadId: target.threadId };
      const result = yield* api.run(input, caller);
      expect(calls).toEqual([`Bearer ${credential.value}`]);
      expect(observation.request?.bodyEncoding).toBe("base64");
      expect(Buffer.from(observation.request!.body, "base64").toString()).toContain(
        credential.value,
      );
      expect(Buffer.from(observation.request!.body, "base64").toString()).toContain("fixture file");
      expect(yield* api.run(input, caller)).toEqual(result);
      expect(calls).toHaveLength(1);
      expect(
        (yield* api
          .run({ ...input, uploads: [{ ...input.uploads[0]!, base64: "ZGlmZmVyZW50" }] }, caller)
          .pipe(Effect.flip)).reason,
      ).toBe("request-conflict");
      expect(JSON.stringify(result)).not.toContain(credential.value);
      expect((yield* api.environment(scope)).variables.some((v) => v.key === "copied")).toBe(false);
      const fs = yield* FileSystem.FileSystem;
      const config = yield* Config.ServerConfig;
      const state = yield* fs.readFileString(
        `${config.stateDir}/fork/browser-dev-tools/api-workspaces/${workspace.workspace.id}/state.json`,
      );
      expect(state).not.toContain(credential.value);
      const current = yield* api.environment(scope);
      const changed = yield* api.saveEnvironment({
        ...scope,
        expectedRevision: current.revision,
        variables: current.variables.map((v) =>
          v.key === "origin" ? { ...v, value: "https://wrong.example.test" } : v,
        ),
      });
      expect(
        (yield* api
          .run(
            { ...input, requestId: "wrong-origin", environmentRevision: changed.revision },
            caller,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("vault-destination");
      credential.allowed = false;
      expect(
        (yield* api
          .run({ ...input, requestId: "revoked", environmentRevision: changed.revision }, caller)
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(calls).toHaveLength(1);
      yield* fs.writeFileString(
        `${root}/.env`,
        "# keep\norigin=http://localhost\ntoken=original\n",
      );
      const dotenv = { ...scope, source: { kind: "dotenv" as const, path: ".env" } };
      const local = yield* api.environment(dotenv);
      yield* api.saveEnvironment({
        ...dotenv,
        expectedRevision: local.revision,
        variables: local.variables.map((v) =>
          v.key === "token" ? bound.variables.find((x) => x.key === "token")! : v,
        ),
      });
      expect(yield* fs.readFileString(`${root}/.env`)).toBe(
        "# keep\norigin=http://localhost\ntoken=original\n",
      );
      expect(
        (yield* api.environment(dotenv)).variables.find((v) => v.key === "token")?.vault?.itemId,
      ).toBe(item.id);
    }).pipe(provide),
);
