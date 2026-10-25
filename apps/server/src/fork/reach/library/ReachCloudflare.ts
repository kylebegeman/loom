import type { ReachAllowlistState, ReachRateLimitState } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  REACH_EDGE_RULE_PREFIX,
  REACH_RATE_LIMIT_RULE,
  reachIngressConfiguration,
  reachWafRule,
} from "@t3tools/shared/fork/reach";
import * as ByteSize from "effect/ByteSize";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Base64 from "effect/encoding/Base64";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import { readReachCredential, reachLibraryConfig } from "./credentials.ts";

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
export const WAF_PHASE = "http_request_firewall_custom";
export const RATE_LIMIT_PHASE = "http_ratelimit";
export const ALLOWLIST_RULE_PREFIX = `${REACH_EDGE_RULE_PREFIX}allowlist`;
export const RATE_LIMIT_RULE_PREFIX = `${REACH_EDGE_RULE_PREFIX}ratelimit`;
/** Every computer's tunnel; the name is how a lost store finds it again. */
export const reachTunnelName = (environmentId: string) => `loom-reach-${environmentId}`;
export const reachTunnelTarget = (tunnelId: string) => `${tunnelId}.cfargotunnel.com`;
/** Marks a DNS record as this computer's, so a lost store still tells it from a foreign one. */
export const reachDnsComment = (environmentId: string) =>
  `${REACH_EDGE_RULE_PREFIX}${environmentId}`;

const REQUEST_TIMEOUT = "15 seconds";
// A tunnel list for a few hundred computers stays well under this.
const RESPONSE_MAX = ByteSize.mebibytes(4);
/** Cloudflare blocks a client that passes its API limit for five minutes. */
const DEFAULT_RETRY_AFTER_SECONDS = 300;
const LOGGED_MESSAGE_MAX = 200;

/**
 * Has no cause on purpose: an HTTP client error holds the request, and a tunnel-secret PATCH or a
 * token GET would carry a secret into logs and across the wire.
 */
export class ReachCloudflareError extends Schema.TaggedError<ReachCloudflareError>()(
  "ReachCloudflareError",
  {
    stage: Schema.String,
    reason: Schema.Literals([
      "credential",
      "denied",
      "limited",
      "unavailable",
      "not-found",
      "invalid",
      "busy",
    ]),
    retryAfterSeconds: Schema.optionalKey(Schema.Number),
  },
) {
  override get message(): string {
    return `Cloudflare ${this.stage} failed: ${this.reason}.`;
  }
}

export interface CloudflareTunnel {
  readonly id: string;
  readonly name: string;
  readonly deletedAt: string | null;
  readonly status: string | null;
  /** Distinct connectors from the deprecated `connections` list, or null when it is absent. */
  readonly connectors: number | null;
}

export interface CloudflareDnsRecord {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly content: string | null;
  readonly proxied: boolean | null;
  readonly comment: string | null;
}

export interface ReachEdgeRules {
  readonly rulesetId: string | null;
  readonly allowlistRuleId: string | null;
  readonly allowlist: ReachAllowlistState;
  readonly rateLimitRulesetId: string | null;
  readonly rateLimitRuleId: string | null;
  readonly rateLimit: ReachRateLimitState;
}

export interface ReachCname {
  readonly name: string;
  readonly content: string;
  readonly comment: string;
}

type Call<A> = Effect.Effect<A, ReachCloudflareError>;

export class ReachCloudflare extends Context.Service<
  ReachCloudflare,
  {
    readonly findZone: (
      name: string,
    ) => Call<{ readonly zoneId: string; readonly accountId: string }>;
    /**
     * The WAF allowlist must exist before any tunnel does. The rate-limit rule is best effort and
     * never fails this: a rule the Library does not own leaves it `occupied`.
     */
    readonly ensureEdgeRules: (input: {
      readonly zoneId: string;
      readonly zone: string;
    }) => Call<ReachEdgeRules>;
    readonly getTunnel: (accountId: string, tunnelId: string) => Call<CloudflareTunnel | null>;
    /** Exact name match on this side: Cloudflare's `name` filter is not documented as exact. */
    readonly findTunnel: (accountId: string, name: string) => Call<CloudflareTunnel | null>;
    readonly createTunnel: (accountId: string, name: string) => Call<CloudflareTunnel>;
    readonly listTunnels: (accountId: string) => Call<ReadonlyArray<CloudflareTunnel>>;
    readonly putIngress: (input: {
      readonly accountId: string;
      readonly tunnelId: string;
      readonly hostname: string;
      readonly origin: string;
    }) => Call<void>;
    /** A fresh `tunnel_secret` kills every connector token issued before it. */
    readonly rotateSecret: (accountId: string, tunnelId: string) => Call<void>;
    readonly clearConnections: (accountId: string, tunnelId: string) => Call<void>;
    /** A missing tunnel counts as deleted. Attached connectors fail with `busy`. */
    readonly deleteTunnel: (accountId: string, tunnelId: string) => Call<void>;
    readonly tunnelToken: (accountId: string, tunnelId: string) => Call<Redacted.Redacted<string>>;
    readonly findDns: (zoneId: string, name: string) => Call<ReadonlyArray<CloudflareDnsRecord>>;
    readonly getDns: (zoneId: string, recordId: string) => Call<CloudflareDnsRecord | null>;
    readonly createCname: (zoneId: string, record: ReachCname) => Call<CloudflareDnsRecord>;
    readonly patchCname: (
      zoneId: string,
      recordId: string,
      record: ReachCname,
    ) => Call<CloudflareDnsRecord>;
    /** A missing record counts as deleted. */
    readonly deleteDns: (zoneId: string, recordId: string) => Call<void>;
  }
>()("t3/fork/reach/library/ReachCloudflare") {}

const Envelope = Schema.Struct({
  success: Schema.optional(Schema.Boolean),
  errors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        code: Schema.optional(Schema.Number),
        message: Schema.optional(Schema.String),
      }),
    ),
  ),
  result: Schema.optional(Schema.Unknown),
});
const decodeEnvelope = Schema.decodeUnknownOption(Envelope);

const Zone = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  account: Schema.Struct({ id: Schema.String }),
});
const decodeZones = Schema.decodeUnknownOption(Schema.Array(Zone));

const Rule = Schema.Struct({
  id: Schema.String,
  description: Schema.optional(Schema.String),
  expression: Schema.optional(Schema.String),
  action: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  ratelimit: Schema.optional(
    Schema.Struct({
      characteristics: Schema.optional(Schema.Array(Schema.String)),
      period: Schema.optional(Schema.Number),
      requests_per_period: Schema.optional(Schema.Number),
      mitigation_timeout: Schema.optional(Schema.Number),
    }),
  ),
});
type Rule = typeof Rule.Type;
const decodeRuleset = Schema.decodeUnknownOption(
  Schema.Struct({ id: Schema.String, rules: Schema.optional(Schema.Array(Rule)) }),
);

const Tunnel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  deleted_at: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  connections: Schema.optional(
    Schema.Array(
      Schema.Struct({
        client_id: Schema.optional(Schema.String),
        id: Schema.optional(Schema.String),
      }),
    ),
  ),
});
const decodeTunnel = Schema.decodeUnknownOption(Tunnel);
const decodeTunnels = Schema.decodeUnknownOption(Schema.Array(Tunnel));

const DnsRecord = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  name: Schema.String,
  content: Schema.optional(Schema.NullOr(Schema.String)),
  proxied: Schema.optional(Schema.NullOr(Schema.Boolean)),
  comment: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeDnsRecord = Schema.decodeUnknownOption(DnsRecord);
const decodeDnsRecords = Schema.decodeUnknownOption(Schema.Array(DnsRecord));
const decodeToken = Schema.decodeUnknownOption(Schema.String.check(Schema.isNonEmpty()));

const toTunnel = (tunnel: typeof Tunnel.Type): CloudflareTunnel => ({
  id: tunnel.id,
  name: tunnel.name,
  deletedAt: tunnel.deleted_at ?? null,
  status: tunnel.status ?? null,
  // One cloudflared holds several edge connections under one client id.
  connectors:
    tunnel.connections === undefined
      ? null
      : new Set(
          tunnel.connections.flatMap((connection) => connection.client_id ?? connection.id ?? []),
        ).size,
});

const toDnsRecord = (record: typeof DnsRecord.Type): CloudflareDnsRecord => ({
  id: record.id,
  type: record.type,
  name: record.name,
  content: record.content ?? null,
  proxied: record.proxied ?? null,
  comment: record.comment ?? null,
});

const segment = encodeURIComponent;

const reasonFor = (status: number, message: string): ReachCloudflareError["reason"] => {
  if (status === 401 || status === 403) return "denied";
  if (status === 429) return "limited";
  if (status === 404) return "not-found";
  if (status >= 500) return "unavailable";
  return /active connections/iu.test(message) ? "busy" : "invalid";
};

const retryAfterSeconds = (header: string | undefined) => {
  const seconds = Number(header);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS;
};

type DesiredRule = {
  readonly action: string;
  readonly description: string;
  readonly expression: string;
  readonly enabled: boolean;
  readonly ratelimit?: {
    readonly characteristics: ReadonlyArray<string>;
    readonly period: number;
    readonly requests_per_period: number;
    readonly mitigation_timeout: number;
  };
};

/** Compares only what the Library sets, so fields Cloudflare adds do not force a PATCH. */
const sameRule = (existing: Rule, desired: DesiredRule) =>
  existing.description === desired.description &&
  existing.expression === desired.expression &&
  existing.action === desired.action &&
  (existing.enabled ?? true) === desired.enabled &&
  (desired.ratelimit === undefined ||
    (existing.ratelimit !== undefined &&
      existing.ratelimit.period === desired.ratelimit.period &&
      existing.ratelimit.requests_per_period === desired.ratelimit.requests_per_period &&
      existing.ratelimit.mitigation_timeout === desired.ratelimit.mitigation_timeout &&
      (existing.ratelimit.characteristics ?? []).join(" ") ===
        desired.ratelimit.characteristics.join(" ")));

const ownRule = (rules: ReadonlyArray<Rule>, prefix: string) =>
  rules.find((rule) => rule.description?.startsWith(prefix) === true);

const make = Effect.gen(function* () {
  const env = yield* HostProcess.Environment;
  const { cloudflareTokenFile } = reachLibraryConfig(env);
  const http = yield* HttpClient.HttpClient;
  const fs = yield* FileSystem.FileSystem;

  const fail = (stage: string, reason: ReachCloudflareError["reason"]) =>
    new ReachCloudflareError({ stage, reason });

  /** One authenticated exchange; answers the envelope's `result` or a mapped refusal. */
  // Each caller is an `Effect.fn` span already; a span per exchange would only repeat it.
  const send = Effect.fnUntraced(function* (
    stage: string,
    request: HttpClientRequest.HttpClientRequest,
  ) {
    // Read per call, so a rotated token needs no restart and never sits in memory between calls.
    const token = yield* readReachCredential(cloudflareTokenFile).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.mapError(() => fail(stage, "credential")),
    );
    const answer = yield* http
      .execute(request.pipe(HttpClientRequest.bearerToken(token), HttpClientRequest.acceptJson))
      .pipe(
        Effect.flatMap((response) =>
          response.json.pipe(
            Effect.orElseSucceed(() => null),
            Effect.map((body) => ({
              status: response.status,
              retryAfter: response.headers["retry-after"],
              envelope: Option.getOrNull(decodeEnvelope(body)),
            })),
          ),
        ),
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.provideService(HttpIncomingMessage.MaxBodySize, RESPONSE_MAX),
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.mapError(() => fail(stage, "unavailable")),
      );
    const ok = answer.status >= 200 && answer.status < 300;
    if (ok && answer.envelope?.success !== false) return answer.envelope?.result;
    const first = answer.envelope?.errors?.[0];
    const status = ok ? 400 : answer.status;
    const reason = reasonFor(status, first?.message ?? "");
    if (reason !== "not-found")
      yield* Effect.logWarning("Cloudflare refused a reach call.", {
        stage,
        status: answer.status,
        code: first?.code ?? null,
        message: first?.message?.slice(0, LOGGED_MESSAGE_MAX) ?? null,
      });
    return yield* reason === "limited"
      ? new ReachCloudflareError({
          stage,
          reason,
          retryAfterSeconds: retryAfterSeconds(answer.retryAfter),
        })
      : fail(stage, reason);
  });

  const expect =
    <A>(stage: string, decode: (input: unknown) => Option.Option<A>) =>
    (result: unknown) =>
      Option.match(decode(result), {
        onNone: () =>
          Effect.logWarning("Cloudflare answered a reach call with an unexpected shape.", {
            stage,
          }).pipe(Effect.andThen(Effect.fail(fail(stage, "invalid")))),
        onSome: (value) => Effect.succeed(value),
      });

  const orNull = <A>(effect: Call<A>): Call<A | null> =>
    effect.pipe(
      Effect.catchIf(
        (error) => error.reason === "not-found",
        () => Effect.succeed(null),
      ),
    );

  const zones = `${CLOUDFLARE_API}/zones`;
  const tunnels = (accountId: string) =>
    `${CLOUDFLARE_API}/accounts/${segment(accountId)}/cfd_tunnel`;
  const tunnel = (accountId: string, tunnelId: string) =>
    `${tunnels(accountId)}/${segment(tunnelId)}`;
  const entrypoint = (zoneId: string, phase: string) =>
    `${zones}/${segment(zoneId)}/rulesets/phases/${phase}/entrypoint`;
  const rules = (zoneId: string, rulesetId: string) =>
    `${zones}/${segment(zoneId)}/rulesets/${segment(rulesetId)}/rules`;
  const dnsRecords = (zoneId: string) => `${zones}/${segment(zoneId)}/dns_records`;

  const findZone = Effect.fn("ReachCloudflare.findZone")(function* (name: string) {
    const found = yield* send(
      "zone",
      HttpClientRequest.get(zones).pipe(HttpClientRequest.setUrlParam("name", name)),
    ).pipe(Effect.flatMap(expect("zone", decodeZones)));
    const matches = found.filter((zone) => zone.name === name);
    const [zone] = matches;
    if (zone === undefined || matches.length !== 1) {
      yield* Effect.logWarning("Cloudflare does not show this token exactly one reach zone.", {
        stage: "zone",
        matches: matches.length,
      });
      return yield* fail("zone", "not-found");
    }
    return { zoneId: zone.id, accountId: zone.account.id };
  });

  const getEntrypoint = (stage: string, zoneId: string, phase: string) =>
    orNull(
      send(stage, HttpClientRequest.get(entrypoint(zoneId, phase))).pipe(
        Effect.flatMap(expect(stage, decodeRuleset)),
      ),
    );

  /** Only on a 404: a PUT replaces every rule in the phase. */
  const putEntrypoint = (stage: string, zoneId: string, phase: string, rule: DesiredRule) =>
    send(
      stage,
      HttpClientRequest.put(entrypoint(zoneId, phase)).pipe(
        HttpClientRequest.bodyJsonUnsafe({ rules: [rule] }),
      ),
    ).pipe(Effect.flatMap(expect(stage, decodeRuleset)));

  const createRule = (
    stage: string,
    zoneId: string,
    rulesetId: string,
    rule: DesiredRule,
    first: boolean,
  ) =>
    send(
      stage,
      HttpClientRequest.post(rules(zoneId, rulesetId)).pipe(
        // `position` is documented for custom rules; first keeps a foreign skip rule from
        // running ahead of the block.
        HttpClientRequest.bodyJsonUnsafe(first ? { ...rule, position: { index: 1 } } : rule),
      ),
    ).pipe(Effect.flatMap(expect(stage, decodeRuleset)));

  /** Per-rule PATCH is not verified against the live API, so callers keep the old rule on failure. */
  const updateRule = (
    stage: string,
    zoneId: string,
    rulesetId: string,
    ruleId: string,
    rule: DesiredRule,
  ) =>
    send(
      stage,
      HttpClientRequest.patch(`${rules(zoneId, rulesetId)}/${segment(ruleId)}`).pipe(
        HttpClientRequest.bodyJsonUnsafe(rule),
      ),
    ).pipe(Effect.flatMap(expect(stage, decodeRuleset)));

  const ruleIdIn = (
    ruleset: { readonly rules?: ReadonlyArray<Rule> | undefined },
    prefix: string,
  ) => ownRule(ruleset.rules ?? [], prefix)?.id ?? null;

  /** Invalid requests become a `failed` rule rather than an error; the rest propagate. */
  const refusedAsNull = <A>(effect: Call<A>): Call<A | null> =>
    effect.pipe(
      Effect.catchIf(
        (error) => error.reason === "invalid" || error.reason === "not-found",
        () => Effect.succeed(null),
      ),
    );

  const ensureAllowlist = Effect.fn("ReachCloudflare.ensureAllowlist")(function* (
    zoneId: string,
    zone: string,
  ) {
    const desired = reachWafRule(zone);
    if (desired === null) return { rulesetId: null, ruleId: null, state: "failed" as const };
    const ruleset = yield* getEntrypoint("allowlist.get", zoneId, WAF_PHASE);
    if (ruleset === null) {
      const created = yield* refusedAsNull(
        putEntrypoint("allowlist.put", zoneId, WAF_PHASE, desired),
      );
      return created === null
        ? { rulesetId: null, ruleId: null, state: "failed" as const }
        : {
            rulesetId: created.id,
            ruleId: ruleIdIn(created, ALLOWLIST_RULE_PREFIX),
            state: "ready" as const,
          };
    }
    const ours = ownRule(ruleset.rules ?? [], ALLOWLIST_RULE_PREFIX);
    if (ours === undefined) {
      const created = yield* refusedAsNull(
        createRule("allowlist.create", zoneId, ruleset.id, desired, true),
      );
      return {
        rulesetId: ruleset.id,
        ruleId: created === null ? null : ruleIdIn(created, ALLOWLIST_RULE_PREFIX),
        state: created === null ? ("failed" as const) : ("ready" as const),
      };
    }
    if (sameRule(ours, desired)) {
      return { rulesetId: ruleset.id, ruleId: ours.id, state: "ready" as const };
    }
    const updated = yield* updateRule(
      "allowlist.update",
      zoneId,
      ruleset.id,
      ours.id,
      desired,
    ).pipe(Effect.option);
    return {
      rulesetId: ruleset.id,
      ruleId: ours.id,
      // The older rule still blocks; it only lags the guard's list until a PATCH lands.
      state: Option.isSome(updated) ? ("ready" as const) : ("stale" as const),
    };
  });

  const ensureRateLimit = Effect.fn("ReachCloudflare.ensureRateLimit")(function* (zoneId: string) {
    const desired: DesiredRule = REACH_RATE_LIMIT_RULE;
    const ruleset = yield* getEntrypoint("ratelimit.get", zoneId, RATE_LIMIT_PHASE);
    if (ruleset === null) {
      const created = yield* putEntrypoint("ratelimit.put", zoneId, RATE_LIMIT_PHASE, desired);
      return {
        rulesetId: created.id,
        ruleId: ruleIdIn(created, RATE_LIMIT_RULE_PREFIX),
        state: "ready" as const,
      };
    }
    const ours = ownRule(ruleset.rules ?? [], RATE_LIMIT_RULE_PREFIX);
    if (ours !== undefined) {
      if (!sameRule(ours, desired)) {
        yield* updateRule("ratelimit.update", zoneId, ruleset.id, ours.id, desired).pipe(
          Effect.tapError(() =>
            Effect.logWarning("The reach rate-limit rule kept its older settings.", {
              stage: "ratelimit.update",
            }),
          ),
          Effect.ignore,
        );
      }
      return { rulesetId: ruleset.id, ruleId: ours.id, state: "ready" as const };
    }
    // The free plan has one rate-limit slot; a rule the Library does not own keeps it.
    if ((ruleset.rules ?? []).length > 0) {
      return { rulesetId: ruleset.id, ruleId: null, state: "occupied" as const };
    }
    const created = yield* createRule("ratelimit.create", zoneId, ruleset.id, desired, false);
    return {
      rulesetId: ruleset.id,
      ruleId: ruleIdIn(created, RATE_LIMIT_RULE_PREFIX),
      state: "ready" as const,
    };
  });

  const ensureEdgeRules = Effect.fn("ReachCloudflare.ensureEdgeRules")(function* (input: {
    readonly zoneId: string;
    readonly zone: string;
  }) {
    const allowlist = yield* ensureAllowlist(input.zoneId, input.zone);
    const rateLimit =
      allowlist.state === "failed"
        ? { rulesetId: null, ruleId: null, state: "failed" as const }
        : yield* ensureRateLimit(input.zoneId).pipe(
            Effect.catchTags({
              ReachCloudflareError: () =>
                Effect.succeed({ rulesetId: null, ruleId: null, state: "failed" as const }),
            }),
          );
    return {
      rulesetId: allowlist.rulesetId,
      allowlistRuleId: allowlist.ruleId,
      allowlist: allowlist.state,
      rateLimitRulesetId: rateLimit.rulesetId,
      rateLimitRuleId: rateLimit.ruleId,
      rateLimit: rateLimit.state,
    } satisfies ReachEdgeRules;
  });

  const getTunnel = Effect.fn("ReachCloudflare.getTunnel")(function* (
    accountId: string,
    tunnelId: string,
  ) {
    const found = yield* orNull(
      send("tunnel.get", HttpClientRequest.get(tunnel(accountId, tunnelId))).pipe(
        Effect.flatMap(expect("tunnel.get", decodeTunnel)),
      ),
    );
    return found === null ? null : toTunnel(found);
  });

  const listMatching = (stage: string, accountId: string, name: string | null) =>
    send(
      stage,
      HttpClientRequest.get(tunnels(accountId)).pipe(
        HttpClientRequest.setUrlParams({
          is_deleted: "false",
          per_page: "1000",
          ...(name === null ? {} : { name }),
        }),
      ),
    ).pipe(
      Effect.flatMap(expect(stage, decodeTunnels)),
      Effect.map((found) => found.map(toTunnel).filter((entry) => entry.deletedAt === null)),
    );

  const findTunnel = Effect.fn("ReachCloudflare.findTunnel")(function* (
    accountId: string,
    name: string,
  ) {
    const found = yield* listMatching("tunnel.find", accountId, name);
    return found.find((entry) => entry.name === name) ?? null;
  });

  const listTunnels = Effect.fn("ReachCloudflare.listTunnels")(function* (accountId: string) {
    return yield* listMatching("tunnel.list", accountId, null);
  });

  const createTunnel = Effect.fn("ReachCloudflare.createTunnel")(function* (
    accountId: string,
    name: string,
  ) {
    const created = yield* send(
      "tunnel.create",
      HttpClientRequest.post(tunnels(accountId)).pipe(
        HttpClientRequest.bodyJsonUnsafe({ name, config_src: "cloudflare" }),
      ),
    ).pipe(Effect.flatMap(expect("tunnel.create", decodeTunnel)));
    return toTunnel(created);
  });

  const putIngress = Effect.fn("ReachCloudflare.putIngress")(function* (input: {
    readonly accountId: string;
    readonly tunnelId: string;
    readonly hostname: string;
    readonly origin: string;
  }) {
    yield* send(
      "ingress.put",
      HttpClientRequest.put(`${tunnel(input.accountId, input.tunnelId)}/configurations`).pipe(
        HttpClientRequest.bodyJsonUnsafe(reachIngressConfiguration(input.hostname, input.origin)),
      ),
    );
  });

  const rotateSecret = Effect.fn("ReachCloudflare.rotateSecret")(function* (
    accountId: string,
    tunnelId: string,
  ) {
    const secret = Base64.encode(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    yield* send(
      "tunnel.rotate",
      HttpClientRequest.patch(tunnel(accountId, tunnelId)).pipe(
        HttpClientRequest.bodyJsonUnsafe({ tunnel_secret: secret }),
      ),
    );
  });

  const clearConnections = Effect.fn("ReachCloudflare.clearConnections")(function* (
    accountId: string,
    tunnelId: string,
  ) {
    yield* send(
      "connections.clear",
      HttpClientRequest.delete(`${tunnel(accountId, tunnelId)}/connections`),
    );
  });

  const deleteTunnel = Effect.fn("ReachCloudflare.deleteTunnel")(function* (
    accountId: string,
    tunnelId: string,
  ) {
    yield* orNull(send("tunnel.delete", HttpClientRequest.delete(tunnel(accountId, tunnelId))));
  });

  const tunnelToken = Effect.fn("ReachCloudflare.tunnelToken")(function* (
    accountId: string,
    tunnelId: string,
  ) {
    const token = yield* send(
      "token.get",
      HttpClientRequest.get(`${tunnel(accountId, tunnelId)}/token`),
    ).pipe(Effect.flatMap(expect("token.get", decodeToken)));
    return Redacted.make(token);
  });

  const findDns = Effect.fn("ReachCloudflare.findDns")(function* (zoneId: string, name: string) {
    const found = yield* send(
      "dns.find",
      HttpClientRequest.get(dnsRecords(zoneId)).pipe(
        HttpClientRequest.setUrlParams({ "name.exact": name, per_page: "100" }),
      ),
    ).pipe(Effect.flatMap(expect("dns.find", decodeDnsRecords)));
    // Exact on this side too, so a lenient filter can never hand over another name's record.
    return found.filter((record) => record.name === name).map(toDnsRecord);
  });

  const getDns = Effect.fn("ReachCloudflare.getDns")(function* (zoneId: string, recordId: string) {
    const found = yield* orNull(
      send("dns.get", HttpClientRequest.get(`${dnsRecords(zoneId)}/${segment(recordId)}`)).pipe(
        Effect.flatMap(expect("dns.get", decodeDnsRecord)),
      ),
    );
    return found === null ? null : toDnsRecord(found);
  });

  const cnameBody = (record: ReachCname) => ({
    type: "CNAME",
    name: record.name,
    content: record.content,
    proxied: true,
    ttl: 1,
    comment: record.comment,
  });

  const createCname = Effect.fn("ReachCloudflare.createCname")(function* (
    zoneId: string,
    record: ReachCname,
  ) {
    const created = yield* send(
      "dns.create",
      HttpClientRequest.post(dnsRecords(zoneId)).pipe(
        HttpClientRequest.bodyJsonUnsafe(cnameBody(record)),
      ),
    ).pipe(Effect.flatMap(expect("dns.create", decodeDnsRecord)));
    return toDnsRecord(created);
  });

  const patchCname = Effect.fn("ReachCloudflare.patchCname")(function* (
    zoneId: string,
    recordId: string,
    record: ReachCname,
  ) {
    const patched = yield* send(
      "dns.patch",
      HttpClientRequest.patch(`${dnsRecords(zoneId)}/${segment(recordId)}`).pipe(
        HttpClientRequest.bodyJsonUnsafe(cnameBody(record)),
      ),
    ).pipe(Effect.flatMap(expect("dns.patch", decodeDnsRecord)));
    return toDnsRecord(patched);
  });

  const deleteDns = Effect.fn("ReachCloudflare.deleteDns")(function* (
    zoneId: string,
    recordId: string,
  ) {
    yield* orNull(
      send("dns.delete", HttpClientRequest.delete(`${dnsRecords(zoneId)}/${segment(recordId)}`)),
    );
  });

  return ReachCloudflare.of({
    findZone,
    ensureEdgeRules,
    getTunnel,
    findTunnel,
    createTunnel,
    listTunnels,
    putIngress,
    rotateSecret,
    clearConnections,
    deleteTunnel,
    tunnelToken,
    findDns,
    getDns,
    createCname,
    patchCname,
    deleteDns,
  });
});

export const layer = Layer.effect(ReachCloudflare, make);
