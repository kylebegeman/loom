import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";

export const SITES_FEATURE = "sites";
export const SITES_MANAGEMENT_FEATURE = "sites-management";
const projectId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
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
      projectIds: Schema.optionalKey(Schema.Array(projectId)),
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
      expected_status: Schema.optionalKey(count),
      content: Schema.optionalKey(text),
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
const name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120));
const ids = Schema.Array(SiteId).check(Schema.isMaxLength(20));
export const SaveSiteRequest = Schema.Struct({
  id: SiteId,
  name,
  url: httpsUrl,
  active: Schema.Boolean,
  origins: Schema.Array(httpsUrl).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  serviceIds: ids,
  projectIds: Schema.Array(projectId).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
});
export type SaveSiteRequest = typeof SaveSiteRequest.Type;
export const SaveSiteServiceRequest = Schema.Struct({
  id: SiteId,
  name,
  url: httpsUrl,
  active: Schema.Boolean,
  kind: Schema.Literals(["website", "api", "redirect"]),
});
export type SaveSiteServiceRequest = typeof SaveSiteServiceRequest.Type;
export const SaveSiteCheckRequest = Schema.Struct({
  id: SiteId,
  name,
  url: httpsUrl,
  active: Schema.Boolean,
  service_id: SiteId,
  expected_status: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(200),
    Schema.isLessThanOrEqualTo(399),
  ),
  content: Schema.String.check(Schema.isMaxLength(120)),
});
export type SaveSiteCheckRequest = typeof SaveSiteCheckRequest.Type;
export const SitesState = Schema.Struct({
  configured: Schema.Boolean,
  snapshot: Schema.NullOr(SitesSnapshot),
  managementConfigured: Schema.optionalKey(Schema.Boolean),
});
export class SitesError extends Schema.TaggedError<SitesError>()("SitesError", {
  stage: Schema.Literals([
    "configuration",
    "authentication",
    "read",
    "write",
    "validation",
    "project",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.stage === "configuration"
      ? "Sites is not configured on this Library server."
      : this.stage === "authentication"
        ? "Sites could not sign in to the personal API. Check the Library server's integration."
        : this.stage === "project"
          ? "Choose existing projects from this Library before saving the site."
          : this.stage === "validation"
            ? "Check the site settings. Use exact HTTPS origins, unique analytics origins, and registered services. Checks must use their service's origin."
            : this.stage === "write"
              ? "Sites could not save to the personal API. Refresh before trying again."
              : "Sites could not load from the personal API. Try refreshing.";
  }
}
export const SITES_WS_METHODS = {
  snapshot: "loom.sites.snapshot",
  analytics: "loom.sites.analytics",
  saveSite: "loom.sites.saveSite",
  saveService: "loom.sites.saveService",
  saveCheck: "loom.sites.saveCheck",
  runChecks: "loom.sites.runChecks",
} as const;
const error = Schema.Union([SitesError, EnvironmentAuthorizationError]);
export const SitesRpcGroup = RpcGroup.make(
  Rpc.make(SITES_WS_METHODS.saveSite, { payload: SaveSiteRequest, success: SitesSnapshot, error }),
  Rpc.make(SITES_WS_METHODS.saveService, {
    payload: SaveSiteServiceRequest,
    success: SitesSnapshot,
    error,
  }),
  Rpc.make(SITES_WS_METHODS.saveCheck, {
    payload: SaveSiteCheckRequest,
    success: SitesSnapshot,
    error,
  }),
  Rpc.make(SITES_WS_METHODS.runChecks, {
    payload: Schema.Struct({}),
    success: SitesSnapshot,
    error,
  }),
  Rpc.make(SITES_WS_METHODS.snapshot, { payload: Schema.Struct({}), success: SitesState, error }),
  Rpc.make(SITES_WS_METHODS.analytics, {
    payload: Schema.Struct({ siteId: SiteId }),
    success: SiteAnalytics,
    error,
  }),
);
