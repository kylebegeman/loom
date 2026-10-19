import {
  ProviderDriverKind,
  UsageLimitSourceError,
  type ServerProviderUsageLimits,
  type UsageLimitSourceAccount,
} from "@t3tools/contracts";
import { makeUnavailableUsageLimits } from "@t3tools/provider-core/server/usageLimits";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { codexPlanLabel } from "../../provider/CodexProvider.ts";
import { claudeUsageResponseToLimits } from "../../provider/claudeUsageLimits.ts";
import { codexRateLimitsToLimits } from "../../provider/codexUsageLimits.ts";
import { isCurrentEvaluation, switchboardDriver } from "./limits.ts";
import type { SwitchboardUsageSource } from "./switchboard.ts";

/**
 * Switchboard's controller owns usage collection for its hub, so a Limits read of
 * that hub uses the controller's cached `GET /api/v1/usage` instead of polling
 * every subscription again. Readings keep their original observation time, and a
 * reading Switchboard marks stale, reused or failed is reported as unavailable.
 * Loom never falls back to provider polling when the controller is down.
 */
const Window = Schema.NullOr(
  Schema.Struct({ usedPercent: Schema.Number, resetsAt: Schema.NullOr(Schema.Number) }),
);
export const CachedUsage = Schema.Struct({
  version: Schema.Literal(1),
  service: Schema.Literal("switchboard"),
  evaluatedAt: Schema.String,
  health: Schema.Struct({
    stale: Schema.optional(Schema.Boolean),
    error: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  accounts: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      email: Schema.optional(Schema.NullOr(Schema.String)),
      provider: Schema.String,
      usage: Schema.NullOr(
        Schema.Struct({
          session: Schema.optional(Window),
          weekly: Schema.optional(Window),
          plan: Schema.optional(Schema.NullOr(Schema.String)),
          scoped: Schema.optional(
            Schema.Array(
              Schema.Struct({
                model: Schema.String,
                usedPercent: Schema.Number,
                resetsAt: Schema.NullOr(Schema.Number),
              }),
            ),
          ),
        }),
      ),
      usageAt: Schema.NullOr(Schema.String),
      stale: Schema.Boolean,
      reused: Schema.Boolean,
      error: Schema.optional(Schema.NullOr(Schema.String)),
      resetCredits: Schema.optional(
        Schema.NullOr(
          Schema.Struct({
            checkedAt: Schema.String,
            availableCount: Schema.Number,
            nextCreditId: Schema.optional(Schema.String),
            nextExpiresAt: Schema.optional(Schema.String),
            error: Schema.optional(Schema.String),
          }),
        ),
      ),
    }),
  ),
});
type CachedUsage = typeof CachedUsage.Type;
type CachedAccount = CachedUsage["accounts"][number];
type CachedWindow = typeof Window.Type;

/** The hub's own credential listing, which names the ids and workspaces direct reads use. */
export interface HubAuthFile {
  readonly id: string;
  readonly name?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly id_token?:
    | {
        readonly chatgpt_account_id?: string | undefined;
        readonly chatgpt_plan_type?: string | undefined;
      }
    | undefined;
}

/** Switchboard withholds credits older than this from redemption; Loom checks again by its own clock. */
const RESET_CREDITS_MAX_AGE_MS = 10 * 60_000;
const FUTURE_SKEW_MS = 60_000;
const UNCERTAIN_MESSAGE =
  "Switchboard has no current reading. Loom does not poll the provider in its place.";

const isoAt = (value: string | number | null | undefined): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const at = DateTime.make(value);
  return Option.isSome(at) ? DateTime.formatIso(at.value) : undefined;
};

const codexLimits = (
  usage: NonNullable<CachedAccount["usage"]>,
  checkedAt: string,
): ServerProviderUsageLimits => {
  // Switchboard sorts windows by length, and Codex expects epoch seconds.
  const toWindow = (window: CachedWindow | undefined, windowDurationMins?: number) =>
    window
      ? {
          usedPercent: window.usedPercent,
          resetsAt: window.resetsAt === null ? null : window.resetsAt / 1000,
          ...(windowDurationMins === undefined ? {} : { windowDurationMins }),
        }
      : null;
  // Free and Go have one monthly allowance, which Switchboard files as its long window.
  const monthly = usage.plan === "free" || usage.plan === "go";
  return codexRateLimitsToLimits({
    checkedAt,
    snapshot: {
      planType: usage.plan ?? null,
      primary: monthly ? toWindow(usage.weekly) : toWindow(usage.session, 5 * 60),
      secondary: monthly ? null : toWindow(usage.weekly, 7 * 24 * 60),
    },
  });
};

const claudeLimits = (
  usage: NonNullable<CachedAccount["usage"]>,
  checkedAt: string,
): ServerProviderUsageLimits => {
  const toWindow = (window: CachedWindow | undefined) =>
    window ? { utilization: window.usedPercent, resets_at: isoAt(window.resetsAt) ?? null } : null;
  return claudeUsageResponseToLimits({
    checkedAt,
    response: {
      rate_limits_available: true,
      rate_limits: {
        five_hour: toWindow(usage.session),
        seven_day: toWindow(usage.weekly),
        model_scoped: (usage.scoped ?? []).map((scope) => ({
          display_name: scope.model,
          utilization: scope.usedPercent,
          resets_at: isoAt(scope.resetsAt) ?? null,
        })),
      },
    },
  }).limits;
};

/** Redemption needs a recent, unexpired credit list; anything else is left out. */
const currentResetCredits = (credits: CachedAccount["resetCredits"], now: number) => {
  if (!credits || credits.error !== undefined) return undefined;
  const checkedAt = Date.parse(credits.checkedAt);
  const expiresAt = isoAt(credits.nextExpiresAt);
  if (
    !Number.isFinite(checkedAt) ||
    checkedAt > now + FUTURE_SKEW_MS ||
    now - checkedAt > RESET_CREDITS_MAX_AGE_MS ||
    (credits.nextExpiresAt !== undefined && (!expiresAt || Date.parse(expiresAt) <= now))
  ) {
    return undefined;
  }
  return {
    availableCount: Math.max(0, Math.floor(credits.availableCount)),
    ...(credits.nextCreditId?.trim() ? { nextCreditId: credits.nextCreditId.trim() } : {}),
    ...(expiresAt ? { nextExpiresAt: expiresAt } : {}),
  };
};

/**
 * Maps the controller's readings onto hub accounts. Switchboard names a credential
 * by its file name, so the hub listing, when readable, restores the id and
 * workspace a direct read reports and drops disabled credentials.
 */
export function cachedUsageAccounts(
  snapshot: CachedUsage,
  now: number,
  files: ReadonlyArray<HubAuthFile> | undefined,
): ReadonlyArray<UsageLimitSourceAccount> {
  const snapshotCurrent =
    isCurrentEvaluation(snapshot.evaluatedAt, now) &&
    snapshot.health.stale !== true &&
    snapshot.health.error !== "controller-pass-failed";
  return snapshot.accounts.flatMap((account): ReadonlyArray<UsageLimitSourceAccount> => {
    const driver = switchboardDriver(account.provider);
    if (driver === undefined) return [];
    const file = files?.find((entry) => entry.name === account.id || entry.id === account.id);
    if (file?.disabled) return [];
    const id = (file?.id ?? account.id).trim();
    if (!id) return [];
    const observedAt = isoAt(account.usageAt);
    const checkedAt = observedAt ?? DateTime.formatIso(DateTime.makeUnsafe(now));
    const usage = account.usage;
    const current =
      snapshotCurrent &&
      observedAt !== undefined &&
      !account.stale &&
      !account.reused &&
      (account.error ?? null) === null;
    const workspaceId = file?.id_token?.chatgpt_account_id?.trim();
    const email = account.email?.trim();
    const plan =
      driver === "codex"
        ? codexPlanLabel(usage?.plan ?? file?.id_token?.chatgpt_plan_type)
        : usage
          ? "Claude Subscription"
          : undefined;
    const resetCredits =
      driver === "codex" && current ? currentResetCredits(account.resetCredits, now) : undefined;
    const usageLimits: ServerProviderUsageLimits =
      !current || usage === null
        ? makeUnavailableUsageLimits({
            checkedAt,
            reason: "probeFailed",
            message: UNCERTAIN_MESSAGE,
          })
        : {
            ...(driver === "codex"
              ? codexLimits(usage, checkedAt)
              : claudeLimits(usage, checkedAt)),
            ...(resetCredits ? { resetCredits } : {}),
          };
    return [
      {
        id,
        driver: ProviderDriverKind.make(driver),
        ...(email ? { email } : {}),
        ...(plan ? { plan } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        usageLimits,
      },
    ];
  });
}

const decodeCachedUsage = Schema.decodeUnknownEffect(CachedUsage);
const decodeDashboardSession = Schema.decodeUnknownEffect(
  Schema.Struct({ csrfToken: Schema.String }),
);
const REQUEST_TIMEOUT = "2 seconds";

/**
 * Reads the controller's cached usage; `authFiles` only names accounts, so its
 * failure is tolerated. Without a controller nothing is read, and the hub's
 * accounts are not polled in its place.
 */
export const readSwitchboardUsage = <E>(
  source: SwitchboardUsageSource,
  authFiles: Effect.Effect<ReadonlyArray<HubAuthFile>, E>,
): Effect.Effect<
  ReadonlyArray<UsageLimitSourceAccount>,
  UsageLimitSourceError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const { controller } = source;
    if (controller === null) {
      return yield* new UsageLimitSourceError({
        detail:
          "This Switchboard hub has no controller configured. Set LOOM_SWITCHBOARD_CONTROLLER_URL on this server to its controller origin. Loom does not poll providers in its place.",
      });
    }
    const client = yield* HttpClient.HttpClient;
    const [snapshot, files] = yield* Effect.all(
      [
        client.get(`${controller}/api/v1/usage`).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap((response) => response.json),
          Effect.flatMap(decodeCachedUsage),
          Effect.timeout(REQUEST_TIMEOUT),
          Effect.mapError(
            () =>
              new UsageLimitSourceError({
                detail:
                  "Switchboard's usage collector is unavailable or incompatible. Run switchboard doctor. Loom did not poll providers in its place.",
              }),
          ),
        ),
        authFiles.pipe(Effect.timeout(REQUEST_TIMEOUT), Effect.option),
      ],
      { concurrency: 2 },
    );
    return cachedUsageAccounts(
      snapshot,
      yield* Clock.currentTimeMillis,
      Option.getOrUndefined(files),
    );
  }).pipe(Effect.withSpan("Switchboard.readUsage"));

/**
 * Asks the controller for a coordinated collection, as its dashboard does. A 429
 * means a collection is already pending or cooling down, which serves as well.
 */
export const requestSharedCollection = Effect.fn("Switchboard.requestCollection")(function* (
  source: SwitchboardUsageSource,
) {
  const { controller } = source;
  if (controller === null) return;
  const client = yield* HttpClient.HttpClient;
  const session = yield* client.get(`${controller}/api/dashboard`).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.json),
    Effect.flatMap(decodeDashboardSession),
  );
  const response = yield* client.execute(
    HttpClientRequest.post(`${controller}/api/v1/refresh`).pipe(
      HttpClientRequest.setHeaders({
        Origin: controller,
        "x-switchboard-csrf": session.csrfToken,
      }),
    ),
  );
  if (response.status !== 202 && response.status !== 429) {
    return yield* new UsageLimitSourceError({
      detail: "Switchboard did not accept the collection request.",
    });
  }
}, Effect.timeout(REQUEST_TIMEOUT));
