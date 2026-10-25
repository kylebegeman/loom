// @effect-diagnostics nodeBuiltinImport:off -- Effect's Crypto has no Ed25519 key generation.
import * as NodeCrypto from "node:crypto";

import { AuthSessionId, EnvironmentId } from "@t3tools/contracts";
import type { ReachRequestBody } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  decodeEd25519PublicKey,
  directoryPublicKeyFromPem,
  keyFingerprint,
} from "@t3tools/shared/fork/directory";
import { signReachRequest } from "@t3tools/shared/fork/reach";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { ServerEnvironmentIdentity } from "../../../environment/ServerEnvironment.ts";
import {
  AuthSessionRepository,
  type AuthSessionRecord,
} from "../../../persistence/AuthSessions.ts";
import { type DirectoryPin, DirectoryService } from "../../directory/DirectoryService.ts";
import * as ReachCloudflare from "./ReachCloudflare.ts";
import * as ReachPocketId from "./ReachPocketId.ts";
import * as ReachProvisioner from "./ReachProvisioner.ts";
import * as ReachStore from "./ReachStore.ts";

export const LIBRARY = "https://library.example.test";
export const ZONE = "reach.example.test";
export const ISSUER = "https://id.example.test";
export const NATIVE_CLIENT_ID = "native-client-1";
export const ZONE_ID = "zone-1";
export const ACCOUNT_ID = "account-1";
/** Distinctive, so a test can search every response and log line for them. */
export const CLOUDFLARE_TOKEN = "cf-token-SECRET-6f1d0c";
export const POCKET_ID_KEY = "pocket-id-key-SECRET-93ab2e";
export const CONNECTOR_TOKEN_PREFIX = "connector-token-SECRET-";
export const LIBRARY_ID = EnvironmentId.make("environment-library");

export interface FakeResponse {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

export interface FakeCall {
  readonly step: string;
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface FakeRule {
  readonly id: string;
  description: string;
  expression: string;
  action: string;
  enabled: boolean;
  ratelimit?: unknown;
}

export interface FakeTunnel {
  readonly id: string;
  readonly name: string;
  deletedAt: string | null;
  status: string;
  connections: Array<{ readonly id: string; readonly client_id: string }>;
  rotations: number;
  config: unknown;
}

export interface FakeDnsRecord {
  readonly id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  comment: string | null;
}

export interface FakeApi {
  readonly id: string;
  readonly name: string;
  readonly resource: string;
}

const ok = (result: unknown, status = 200): FakeResponse => ({
  status,
  body: { success: true, errors: [], messages: [], result },
});

export const cloudflareError = (status: number, code: number, message: string): FakeResponse => ({
  status,
  body: { success: false, errors: [{ code, message }], messages: [], result: null },
});

const notFound = cloudflareError(404, 10_007, "Not found");

const bodyOf = (request: HttpClientRequest.HttpClientRequest): unknown => {
  if (request.body._tag !== "Uint8Array") return null;
  const text = new TextDecoder().decode(request.body.body);
  return text.length === 0 ? null : JSON.parse(text);
};

/**
 * In-memory Cloudflare and Pocket ID behind one HttpClient. Calls are recorded in order under the
 * stage names `ReachCloudflare` logs. `script` answers the next matching call instead of the
 * fake, and any `/api/oidc/clients` or `/api/users` call kills the test.
 */
export class FakeReachApis {
  readonly calls: Array<FakeCall> = [];
  readonly zones = [{ id: ZONE_ID, name: ZONE, account: { id: ACCOUNT_ID } }];
  readonly rulesets = new Map<string, { readonly id: string; rules: Array<FakeRule> }>();
  readonly tunnels = new Map<string, FakeTunnel>();
  readonly dns = new Map<string, FakeDnsRecord>();
  readonly apis = new Map<string, FakeApi>();
  readonly grants = new Map<string, unknown>();
  private readonly scripted: Array<{ readonly step: string; readonly response: FakeResponse }> = [];
  private sequence = 0;

  readonly client: HttpClient.HttpClient = HttpClient.make((request, url) =>
    Effect.suspend(() => {
      const query = Object.fromEntries(url.searchParams.entries());
      const isCloudflare = url.hostname === "api.cloudflare.com";
      if (!isCloudflare && /^\/api\/(?:oidc\/clients|users)/u.test(url.pathname)) {
        return Effect.die(new Error(`Reach must never call ${url.pathname}.`));
      }
      const path = isCloudflare ? url.pathname.replace(/^\/client\/v4/u, "") : url.pathname;
      const body = bodyOf(request);
      const step = isCloudflare
        ? this.cloudflareStep(request.method, path, query)
        : this.pocketIdStep(request.method, path);
      this.calls.push({ step, method: request.method, path, query, body });
      const scripted = this.scripted.findIndex(
        (entry) => entry.step === step || entry.step === "*",
      );
      const answer =
        scripted >= 0
          ? this.scripted.splice(scripted, 1)[0]!.response
          : isCloudflare
            ? request.headers.authorization === `Bearer ${CLOUDFLARE_TOKEN}`
              ? this.cloudflare(step, path, query, body)
              : cloudflareError(403, 10_000, "Authentication error")
            : request.headers["x-api-key"] === POCKET_ID_KEY
              ? this.pocketId(step, path, query, body)
              : { status: 401, body: { error: "Unauthorized" } };
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          answer.status === 204
            ? new Response(null, { status: 204 })
            : Response.json(answer.body ?? null, {
                status: answer.status,
                ...(answer.headers === undefined ? {} : { headers: answer.headers }),
              }),
        ),
      );
    }),
  );

  get steps(): ReadonlyArray<string> {
    return this.calls.map((call) => call.step);
  }

  /** Answers the next `times` calls of one step (or `*`, any step) with `response`. */
  script(step: string, response: FakeResponse, times = 1) {
    for (let index = 0; index < times; index += 1) this.scripted.push({ step, response });
  }

  clearCalls() {
    this.calls.length = 0;
  }

  /** A cloudflared run with this tunnel's token. */
  connect(tunnelId: string, clientId: string) {
    const tunnel = this.tunnels.get(tunnelId);
    if (tunnel === undefined) throw new Error(`No tunnel ${tunnelId}.`);
    tunnel.connections.push({ id: this.nextId("connection"), client_id: clientId });
    tunnel.status = "healthy";
  }

  addTunnel(name: string) {
    const tunnel: FakeTunnel = {
      id: this.nextId("tunnel"),
      name,
      deletedAt: null,
      status: "inactive",
      connections: [],
      rotations: 0,
      config: null,
    };
    this.tunnels.set(tunnel.id, tunnel);
    return tunnel;
  }

  addDns(record: Omit<FakeDnsRecord, "id">) {
    const created = { id: this.nextId("dns"), ...record };
    this.dns.set(created.id, created);
    return created;
  }

  addRule(phase: string, rule: Omit<FakeRule, "id">) {
    const ruleset = this.rulesetFor(phase);
    const created = { id: this.nextId("rule"), ...rule };
    ruleset.rules.push(created);
    return created;
  }

  addApi(name: string, resource: string) {
    const api = { id: this.nextId("api"), name, resource };
    this.apis.set(api.id, api);
    return api;
  }

  tokenOf(tunnel: FakeTunnel) {
    return `${CONNECTOR_TOKEN_PREFIX}${tunnel.id}-${tunnel.rotations}`;
  }

  private nextId(kind: string) {
    this.sequence += 1;
    return `${kind}-${this.sequence}`;
  }

  private rulesetFor(phase: string) {
    const existing = this.rulesets.get(phase);
    if (existing !== undefined) return existing;
    const created = { id: `ruleset-${phase}`, rules: [] };
    this.rulesets.set(phase, created);
    return created;
  }

  private phaseOfRuleset(rulesetId: string) {
    for (const [phase, ruleset] of this.rulesets) if (ruleset.id === rulesetId) return phase;
    return null;
  }

  private ruleStep(phase: string | null, action: string) {
    return `${phase === ReachCloudflare.WAF_PHASE ? "allowlist" : "ratelimit"}.${action}`;
  }

  private cloudflareStep(method: string, path: string, query: Record<string, string>) {
    const parts = path.split("/").filter((part) => part.length > 0);
    if (parts[0] === "zones" && parts.length === 1) return "zone";
    if (parts[0] === "zones" && parts[2] === "rulesets") {
      if (parts[3] === "phases")
        return this.ruleStep(parts[4] ?? null, method === "PUT" ? "put" : "get");
      const phase = this.phaseOfRuleset(parts[3] ?? "");
      return this.ruleStep(phase, method === "POST" ? "create" : "update");
    }
    if (parts[0] === "zones" && parts[2] === "dns_records") {
      if (parts.length === 3) return method === "POST" ? "dns.create" : "dns.find";
      return `dns.${method === "GET" ? "get" : method === "PATCH" ? "patch" : "delete"}`;
    }
    if (parts[0] === "accounts" && parts[2] === "cfd_tunnel") {
      if (parts.length === 3) {
        if (method === "POST") return "tunnel.create";
        return query.name === undefined ? "tunnel.list" : "tunnel.find";
      }
      if (parts[4] === "connections") return "connections.clear";
      if (parts[4] === "configurations") return "ingress.put";
      if (parts[4] === "token") return "token.get";
      return `tunnel.${method === "GET" ? "get" : method === "PATCH" ? "rotate" : "delete"}`;
    }
    return `cloudflare.${method} ${path}`;
  }

  private pocketIdStep(method: string, path: string) {
    if (path === "/api/apis") return method === "POST" ? "api.create" : "api.search";
    if (/^\/api\/apis\/[^/]+\/clients\/[^/]+$/u.test(path)) return "grant.put";
    if (/^\/api\/apis\/[^/]+$/u.test(path) && method === "DELETE") return "api.delete";
    return `pocket-id.${method} ${path}`;
  }

  private publicTunnel(tunnel: FakeTunnel) {
    return {
      id: tunnel.id,
      name: tunnel.name,
      deleted_at: tunnel.deletedAt,
      status: tunnel.status,
      connections: tunnel.connections,
    };
  }

  private cloudflare(
    step: string,
    path: string,
    query: Record<string, string>,
    body: unknown,
  ): FakeResponse {
    const parts = path.split("/").filter((part) => part.length > 0);
    const input = (body ?? {}) as Record<string, unknown>;
    switch (step) {
      case "zone":
        return ok(this.zones.filter((zone) => zone.name === query.name));
      case "allowlist.get":
      case "ratelimit.get": {
        const ruleset = this.rulesets.get(parts[4] ?? "");
        return ruleset === undefined
          ? cloudflareError(404, 10_003, "could not find entrypoint ruleset")
          : ok(ruleset);
      }
      case "allowlist.put":
      case "ratelimit.put": {
        const ruleset = this.rulesetFor(parts[4] ?? "");
        ruleset.rules = ((input.rules ?? []) as Array<Omit<FakeRule, "id">>).map((rule) => ({
          id: this.nextId("rule"),
          ...rule,
        }));
        return ok(ruleset);
      }
      case "allowlist.create":
      case "ratelimit.create": {
        const ruleset = this.rulesetFor(this.phaseOfRuleset(parts[3] ?? "") ?? "");
        const { position, ...rule } = input as { position?: { index: number } } & Omit<
          FakeRule,
          "id"
        >;
        const created = { id: this.nextId("rule"), ...rule };
        ruleset.rules.splice((position?.index ?? ruleset.rules.length + 1) - 1, 0, created);
        return ok(ruleset);
      }
      case "allowlist.update":
      case "ratelimit.update": {
        const ruleset = this.rulesetFor(this.phaseOfRuleset(parts[3] ?? "") ?? "");
        const rule = ruleset.rules.find((entry) => entry.id === parts[5]);
        if (rule === undefined) return notFound;
        Object.assign(rule, input);
        return ok(ruleset);
      }
      case "tunnel.find":
        // Deliberately loose, as Cloudflare's filter is not documented as exact.
        return ok(
          [...this.tunnels.values()]
            .filter((tunnel) => tunnel.deletedAt === null && tunnel.name.includes(query.name ?? ""))
            .map((tunnel) => this.publicTunnel(tunnel)),
        );
      case "tunnel.list":
        return ok(
          [...this.tunnels.values()]
            .filter((tunnel) => tunnel.deletedAt === null)
            .map((tunnel) => this.publicTunnel(tunnel)),
        );
      case "tunnel.create": {
        const tunnel = this.addTunnel(String(input.name));
        return ok(this.publicTunnel(tunnel));
      }
      default:
        break;
    }
    if (
      step.startsWith("tunnel.") ||
      step === "connections.clear" ||
      step === "ingress.put" ||
      step === "token.get"
    ) {
      const tunnel = this.tunnels.get(parts[3] ?? "");
      if (tunnel === undefined) return notFound;
      switch (step) {
        case "tunnel.get":
          return ok(this.publicTunnel(tunnel));
        case "tunnel.rotate":
          if (typeof input.tunnel_secret !== "string" || input.tunnel_secret.length < 40)
            return cloudflareError(400, 1001, "tunnel_secret must be 32 bytes of base64");
          tunnel.rotations += 1;
          return ok(this.publicTunnel(tunnel));
        case "connections.clear":
          tunnel.connections = [];
          tunnel.status = "down";
          return ok(null);
        case "tunnel.delete":
          if (tunnel.connections.length > 0)
            return cloudflareError(
              400,
              1022,
              "Cannot delete tunnel because it has active connections",
            );
          tunnel.deletedAt = "2026-10-24T12:00:00Z";
          return ok(this.publicTunnel(tunnel));
        case "ingress.put":
          tunnel.config = input.config;
          return ok({ tunnel_id: tunnel.id, config: input.config });
        case "token.get":
          return ok(this.tokenOf(tunnel));
      }
    }
    switch (step) {
      case "dns.find":
        return ok([...this.dns.values()].filter((record) => record.name === query["name.exact"]));
      case "dns.create": {
        const record = this.addDns({
          type: String(input.type),
          name: String(input.name),
          content: String(input.content),
          proxied: input.proxied === true,
          comment: typeof input.comment === "string" ? input.comment : null,
        });
        return ok(record);
      }
      case "dns.get":
      case "dns.patch":
      case "dns.delete": {
        const record = this.dns.get(parts[3] ?? "");
        if (record === undefined) return notFound;
        if (step === "dns.get") return ok(record);
        if (step === "dns.delete") {
          this.dns.delete(record.id);
          return ok({ id: record.id });
        }
        Object.assign(record, {
          type: String(input.type),
          content: String(input.content),
          proxied: input.proxied === true,
          comment: typeof input.comment === "string" ? input.comment : null,
        });
        return ok(record);
      }
    }
    return cloudflareError(400, 7003, "No route for that URI");
  }

  private pocketId(
    step: string,
    path: string,
    query: Record<string, string>,
    body: unknown,
  ): FakeResponse {
    const input = (body ?? {}) as Record<string, unknown>;
    const apiId = decodeURIComponent(path.split("/")[3] ?? "");
    switch (step) {
      case "api.create": {
        const resource = String(input.resource);
        if ([...this.apis.values()].some((api) => api.resource === resource))
          return {
            status: 409,
            body: { error: "Resource is already in use", code: "already_in_use" },
          };
        return { status: 201, body: this.addApi(String(input.name), resource) };
      }
      case "api.search": {
        const search = query.search ?? "";
        return {
          status: 200,
          body: {
            data: [...this.apis.values()].filter(
              (api) => api.resource.includes(search) || api.name.includes(search),
            ),
            pagination: {
              totalPages: 1,
              totalItems: this.apis.size,
              currentPage: 1,
              itemsPerPage: 100,
            },
          },
        };
      }
      case "grant.put": {
        if (!this.apis.has(apiId))
          return { status: 404, body: { error: "Not found", code: "not_found" } };
        const clientId = decodeURIComponent(path.split("/")[5] ?? "");
        this.grants.set(`${apiId}:${clientId}`, input);
        return { status: 200, body: { apiId, clientId, ...input } };
      }
      case "api.delete":
        if (!this.apis.delete(apiId))
          return { status: 404, body: { error: "Not found", code: "not_found" } };
        this.grants.forEach((_, key) => {
          if (key.startsWith(`${apiId}:`)) this.grants.delete(key);
        });
        return { status: 204 };
    }
    return { status: 404, body: { error: "Not found" } };
  }
}

export interface ReachKey {
  readonly privateKey: string;
  readonly publicKey: string;
  readonly fingerprint: string;
}

export const reachKey = (): ReachKey => {
  const pair = NodeCrypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  const publicKey = directoryPublicKeyFromPem(pair.publicKey);
  const der = publicKey === null ? null : decodeEd25519PublicKey(publicKey);
  if (publicKey === null || der === null) throw new Error("Expected an Ed25519 public key.");
  return { privateKey: pair.privateKey, publicKey, fingerprint: keyFingerprint(der) };
};

export const pinOf = (key: ReachKey, label: string | null): DirectoryPin => ({
  publicKey: key.publicKey,
  keyFingerprint: key.fingerprint,
  label,
});

/** Signs as a computer would. `nowEpochSeconds` defaults to the fiber's clock. */
export const signedRequest = Effect.fn("ReachTesting.signedRequest")(function* (input: {
  readonly key: ReachKey;
  readonly environmentId: string;
  readonly action: "ensure" | "remove";
  readonly seq: number;
  readonly origin?: string;
  readonly audience?: string;
  readonly nowEpochSeconds?: number;
}) {
  const now = input.nowEpochSeconds ?? (yield* Clock.currentTimeMillis) / 1000;
  const token = yield* signReachRequest({
    privateKey: input.key.privateKey,
    environmentId: input.environmentId,
    audience: input.audience ?? LIBRARY,
    claims:
      input.action === "ensure"
        ? { action: "ensure", seq: input.seq, origin: input.origin ?? "http://127.0.0.1:3773" }
        : { action: "remove", seq: input.seq },
    nowEpochSeconds: now,
  });
  return { token, publicKey: input.key.publicKey } satisfies ReachRequestBody;
});

export const sessionRecord = (
  sessionId: string,
  state: "active" | "revoked",
): AuthSessionRecord => ({
  sessionId: AuthSessionId.make(sessionId),
  subject: "loom-host:computer",
  scopes: [],
  method: "bearer-access-token",
  client: {
    label: null,
    ipAddress: null,
    userAgent: null,
    deviceType: "unknown",
    os: null,
    browser: null,
  },
  issuedAt: DateTime.makeUnsafe("2026-10-01T00:00:00Z"),
  expiresAt: DateTime.makeUnsafe("2027-10-01T00:00:00Z"),
  lastConnectedAt: null,
  revokedAt: state === "revoked" ? DateTime.makeUnsafe("2026-10-02T00:00:00Z") : null,
});

export interface ReachHarness {
  readonly apis: FakeReachApis;
  /** What `DirectoryService.pinned` answers, by environment id. */
  readonly pins: Map<string, DirectoryPin>;
  readonly sessions: Map<string, AuthSessionRecord>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly storeFile: string;
  /** A provisioner over a store file, as one Library process would build it. */
  readonly build: (options?: {
    readonly storeFile?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
  }) => Effect.Effect<
    Context.Context<ReachProvisioner.ReachProvisioner | ReachStore.ReachStore>,
    never,
    Scope.Scope
  >;
}

/**
 * Credential files with 0600 modes in a scoped temp directory, the fakes, and the provisioner's
 * other services as test doubles. No call leaves the process.
 */
export const makeReachHarness = Effect.fn("ReachTesting.makeHarness")(function* (
  options: { readonly env?: Readonly<Record<string, string | undefined>> } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "loom-reach-library-test-" });
  const tokenFile = path.join(directory, "cloudflare-token");
  const keyFile = path.join(directory, "pocket-id-key");
  yield* fs.writeFileString(tokenFile, `${CLOUDFLARE_TOKEN}\n`);
  yield* fs.chmod(tokenFile, 0o600);
  yield* fs.writeFileString(keyFile, POCKET_ID_KEY);
  yield* fs.chmod(keyFile, 0o600);
  const apis = new FakeReachApis();
  const pins = new Map<string, DirectoryPin>();
  const sessions = new Map<string, AuthSessionRecord>();
  const env = {
    LOOM_LIBRARY_AUTHORITY: "true",
    LOOM_IDENTITY_REDIRECT_URI: `${LIBRARY}/api/auth/identity/callback`,
    LOOM_REACH_ZONE: ZONE,
    LOOM_REACH_CLOUDFLARE_TOKEN_FILE: tokenFile,
    LOOM_IDENTITY_ISSUER: ISSUER,
    LOOM_IDENTITY_NATIVE_CLIENT_ID: NATIVE_CLIENT_ID,
    LOOM_IDENTITY_ADMIN_API_KEY_FILE: keyFile,
    ...options.env,
  };
  const storeFile = path.join(directory, "state", "library.json");
  const services = Layer.mergeAll(
    Layer.succeed(HttpClient.HttpClient, apis.client),
    Layer.mock(DirectoryService)({
      pinned: (environmentId) => Effect.succeed(pins.get(environmentId) ?? null),
    }),
    Layer.mock(AuthSessionRepository)({
      getById: ({ sessionId }) => Effect.succeed(Option.fromNullishOr(sessions.get(sessionId))),
    }),
    Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(LIBRARY_ID) }),
  );
  const build: ReachHarness["build"] = (overrides = {}) =>
    Layer.build(
      ReachProvisioner.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            ReachStore.layerAt(overrides.storeFile ?? storeFile),
            ReachCloudflare.layer,
            ReachPocketId.layer,
          ),
        ),
        Layer.provide(services),
        Layer.provide(Layer.succeed(HostProcess.Environment, { ...env, ...overrides.env })),
        Layer.provide(Layer.succeed(FileSystem.FileSystem, fs)),
        Layer.provide(Layer.succeed(Path.Path, path)),
      ),
    ).pipe(Effect.orDie);
  return { apis, pins, sessions, env, storeFile, build } satisfies ReachHarness;
});
