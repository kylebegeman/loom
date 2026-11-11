import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";

export const SITES_FEATURE = "sites";
export const SITES_MANAGEMENT_FEATURE = "sites-management";
export const LIBRARY_SITES_FEATURE = "library-sites";
export const LIBRARY_SITES_READ_ROUTE = "/api/loom/library/sites/read";
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
const httpsOrigin = httpsUrl.check(Schema.makeFilter((value) => new URL(value).origin === value));
const requestId = Schema.String.check(Schema.isPattern(/^[\x21-\x7e]{1,255}$/));
const etag = Schema.String.check(Schema.isPattern(/^"[\x21\x23-\x7e]{1,254}"$/));
const writeFields = {
  requestId: Schema.optionalKey(requestId),
  expectedEtag: Schema.optionalKey(Schema.NullOr(etag)),
};
export const RunSiteChecksRequest = Schema.Struct({ requestId: writeFields.requestId });
export type RunSiteChecksRequest = typeof RunSiteChecksRequest.Type;
export const SitesSnapshot = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  primarySiteId: SiteId,
  ownerAdmin: Schema.optionalKey(Schema.Struct({ name: text, url: httpsUrl })),
  observedAt: Schema.String,
  staleAfterSeconds: count,
  sites: Schema.Array(
    Schema.Struct({
      etag: Schema.optionalKey(etag),
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
      etag: Schema.optionalKey(etag),
      id: SiteId,
      name: text,
      url: httpsUrl,
      active,
      kind: Schema.Literals(["website", "api", "redirect"]),
    }),
  ),
  checks: Schema.Array(
    Schema.Struct({
      etag: Schema.optionalKey(etag),
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
export const SiteChecksRunReceiptRequest = Schema.Struct({ requestId });
export type SiteChecksRunReceiptRequest = typeof SiteChecksRunReceiptRequest.Type;
export const SiteChecksRunReceipt = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["absent", "pending", "unavailable"]) }),
  Schema.Struct({
    state: Schema.Literal("completed"),
    status: Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(200),
      Schema.isLessThan(500),
    ),
    body: Schema.Unknown,
  }),
]);
export type SiteChecksRunReceipt = typeof SiteChecksRunReceipt.Type;

export const SiteAnalytics = Schema.Struct({
  product: Schema.optionalKey(
    Schema.Struct({
      events: count,
      dailyInstallations: count,
      lastEventAt: Schema.NullOr(Schema.String),
      since: Schema.String,
      channel: Schema.String,
      retentionDays: count,
      byDay: Schema.Array(
        Schema.Struct({ day: Schema.String, events: count, installations: count }),
      ),
      byEvent: Schema.Array(
        Schema.Struct({ name: text, outcome: text, count, installations: count }),
      ),
      byCommand: Schema.Array(
        Schema.Struct({ command: text, outcome: text, count, averageDurationMS: count }),
      ),
      byPlatform: Schema.Array(Schema.Struct({ platform: text, count })),
      bySurface: Schema.Array(Schema.Struct({ surface: text, count })),
      byVersion: Schema.Array(Schema.Struct({ version: text, count })),
      byFeatureGroup: Schema.Array(Schema.Struct({ featureGroup: text, count })),
      byStack: Schema.Array(Schema.Struct({ stack: text, count })),
    }),
  ),
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
  referrers: Schema.optionalKey(
    Schema.Array(Schema.Struct({ referrer_host: Schema.String, pageviews: count })),
  ),
  sources: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        source: Schema.String,
        medium: Schema.String,
        campaign: Schema.String,
        pageviews: count,
      }),
    ),
  ),
  countries: Schema.optionalKey(
    Schema.Array(Schema.Struct({ country: Schema.String, pageviews: count })),
  ),
  devices: Schema.optionalKey(
    Schema.Array(Schema.Struct({ device: Schema.String, pageviews: count })),
  ),
  browsers: Schema.optionalKey(
    Schema.Array(Schema.Struct({ browser: Schema.String, pageviews: count })),
  ),
});
export type SiteAnalytics = typeof SiteAnalytics.Type;
const name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120));
const ids = Schema.Array(SiteId).check(Schema.isMaxLength(20));
export const SaveSiteRequest = Schema.Struct({
  ...writeFields,
  id: SiteId,
  name,
  url: httpsOrigin,
  active: Schema.Boolean,
  origins: Schema.Array(httpsOrigin).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  serviceIds: ids,
  projectIds: Schema.Array(projectId).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
}).check(
  Schema.makeFilter(
    (site) => site.origins.includes(site.url) && new Set(site.origins).size === site.origins.length,
  ),
);
export type SaveSiteRequest = typeof SaveSiteRequest.Type;
export const SaveSiteServiceRequest = Schema.Struct({
  ...writeFields,
  id: SiteId,
  name,
  url: httpsOrigin,
  active: Schema.Boolean,
  kind: Schema.Literals(["website", "api", "redirect"]),
});
export type SaveSiteServiceRequest = typeof SaveSiteServiceRequest.Type;
export const SaveSiteCheckRequest = Schema.Struct({
  ...writeFields,
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
export const LibrarySitesMutation = Schema.Union([
  Schema.Struct({ action: Schema.Literal("saveSite"), input: SaveSiteRequest }),
  Schema.Struct({ action: Schema.Literal("saveService"), input: SaveSiteServiceRequest }),
  Schema.Struct({ action: Schema.Literal("saveCheck"), input: SaveSiteCheckRequest }),
  Schema.Struct({
    action: Schema.Literal("runChecks"),
    input: Schema.optionalKey(RunSiteChecksRequest),
  }),
]);
export type LibrarySitesMutation = typeof LibrarySitesMutation.Type;
export const LibrarySitesRead = Schema.Union([
  Schema.Struct({ checkRunRequestId: requestId }),
  Schema.Struct({ siteId: Schema.optionalKey(SiteId) }),
]);
export const SitesState = Schema.Struct({
  configured: Schema.Boolean,
  snapshot: Schema.NullOr(SitesSnapshot),
  managementConfigured: Schema.optionalKey(Schema.Boolean),
});
export class SitesError extends Schema.TaggedError<SitesError>()("SitesError", {
  stage: Schema.Literals([
    "library-connection",
    "library-update",
    "configuration",
    "authentication",
    "permission",
    "revision-conflict",
    "revision-required",
    "request-conflict",
    "unknown-outcome",
    "recovery",
    "read",
    "write",
    "validation",
    "project",
  ]),
  requestId: Schema.optionalKey(requestId),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    const identity = this.requestId ? ` Request: ${this.requestId}.` : "";
    if (this.stage === "revision-conflict")
      return `These settings changed on another management surface. Refresh Sites and review the latest settings before saving again.${identity}`;
    if (this.stage === "revision-required")
      return `Refresh Sites and reopen the editor to load its current revision before saving.${identity}`;
    if (this.stage === "request-conflict")
      return `This request identity was already used for different settings. Read Sites and review a new save; do not replay this request.${identity}`;
    if (this.stage === "unknown-outcome" || this.stage === "write")
      return `Sites could not confirm the change. It may already have applied. Refresh Sites and compare the current settings before an explicit retry. Keep the original request identity; do not retry automatically.${identity}`;
    if (this.stage === "permission")
      return `The Sites integration lacks the required permission. Repair the Library server's integration access, then explicitly continue.${identity}`;
    if (this.stage === "recovery")
      return "Sites cannot preserve this request's recovery information. Restore local storage before saving.";
    return this.stage === "library-connection"
      ? "Sites cannot use this computer's enrolled Library connection. Check Settings > Connections on this computer. Keep the existing Sites connections on the Library."
      : this.stage === "library-update"
        ? "Update Loom on the Library to use Sites from agents. Keep this computer enrolled and keep the existing Sites connections."
        : this.stage === "configuration"
          ? "Sites is not configured on this Library server."
          : this.stage === "authentication"
            ? "Sites could not sign in to the personal API. Check the Library server's integration, then explicitly continue. Sign-in does not repeat the save."
            : this.stage === "project"
              ? "Choose existing projects from this Library before saving the site."
              : this.stage === "validation"
                ? "Check the site settings. Use exact HTTPS origins, unique analytics origins, and registered services. Checks must use their service's origin."
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
  checkRunReceipt: "loom.sites.checkRunReceipt",
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
    payload: RunSiteChecksRequest,
    success: SitesSnapshot,
    error,
  }),
  Rpc.make(SITES_WS_METHODS.checkRunReceipt, {
    payload: SiteChecksRunReceiptRequest,
    success: SiteChecksRunReceipt,
    error,
  }),
  Rpc.make(SITES_WS_METHODS.snapshot, { payload: Schema.Struct({}), success: SitesState, error }),
  Rpc.make(SITES_WS_METHODS.analytics, {
    payload: Schema.Struct({ siteId: SiteId }),
    success: SiteAnalytics,
    error,
  }),
);
