import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";

export const SITES_FEATURE = "sites";
const text = Schema.String.check(Schema.isMaxLength(2048));
const count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const active = Schema.Literals([0, 1]);
export const SiteId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/));
const httpsUrl = text.check(
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }),
);
export const SitesSnapshot = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  primarySiteId: SiteId,
  observedAt: Schema.String,
  staleAfterSeconds: count,
  sites: Schema.Array(
    Schema.Struct({
      id: SiteId,
      name: text,
      url: httpsUrl,
      active,
      origins: Schema.Array(httpsUrl),
      serviceIds: Schema.Array(SiteId),
    }),
  ),
  services: Schema.Array(
    Schema.Struct({
      id: SiteId,
      name: text,
      url: httpsUrl,
      active,
      kind: Schema.Literals(["website", "api", "redirect"]),
    }),
  ),
  checks: Schema.Array(
    Schema.Struct({
      id: text,
      service_id: SiteId,
      name: text,
      url: httpsUrl,
      active,
      state: Schema.Literals(["disabled", "unknown", "stale", "healthy", "failing"]),
      last: Schema.NullOr(
        Schema.Struct({
          checked_at: Schema.String,
          ok: active,
          status: Schema.NullOr(count),
          duration_ms: count,
          tls_expires_at: Schema.NullOr(Schema.String),
          error: Schema.NullOr(text),
        }),
      ),
    }),
  ),
});
export type SitesSnapshot = typeof SitesSnapshot.Type;
export const SiteAnalytics = Schema.Struct({
  siteId: SiteId,
  lastEventAt: Schema.NullOr(Schema.String),
  days: count,
  since: Schema.String,
  pageviews: count,
  visitors: count,
  events: count,
  byDay: Schema.Array(Schema.Struct({ day: Schema.String, pageviews: count, visitors: count })),
  pages: Schema.Array(Schema.Struct({ path: text, pageviews: count, visitors: count })),
  named: Schema.Array(Schema.Struct({ name: text, label: text, target: text, count })),
});
export type SiteAnalytics = typeof SiteAnalytics.Type;
export const SitesState = Schema.Struct({
  configured: Schema.Boolean,
  snapshot: Schema.NullOr(SitesSnapshot),
});
export class SitesError extends Schema.TaggedError<SitesError>()("SitesError", {
  stage: Schema.Literals(["configuration", "authentication", "read"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.stage === "configuration"
      ? "Sites is not configured on this Library server."
      : this.stage === "authentication"
        ? "Sites could not sign in to the personal API. Check the Library server's integration."
        : "Sites could not load from the personal API. Try refreshing.";
  }
}
export const SITES_WS_METHODS = {
  snapshot: "loom.sites.snapshot",
  analytics: "loom.sites.analytics",
} as const;
const error = Schema.Union([SitesError, EnvironmentAuthorizationError]);
export const SitesRpcGroup = RpcGroup.make(
  Rpc.make(SITES_WS_METHODS.snapshot, { payload: Schema.Struct({}), success: SitesState, error }),
  Rpc.make(SITES_WS_METHODS.analytics, {
    payload: Schema.Struct({ siteId: SiteId }),
    success: SiteAnalytics,
    error,
  }),
);
