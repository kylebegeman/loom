import type {
  SwitchboardLimit,
  SwitchboardLimits,
  SwitchboardModelAvailability,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";

/**
 * Switchboard's controller evaluates its cached readings on every request, so
 * `evaluatedAt` is the time of this read. An older one means something cached
 * the response, or the clocks disagree, and none of it is trusted to block models.
 */
export const AVAILABILITY_MAX_AGE_MS = 5 * 60_000;
const FUTURE_SKEW_MS = 60_000;

/** Whether a controller response was evaluated recently by this server's clock. */
export function isCurrentEvaluation(evaluatedAt: string, now: number): boolean {
  const at = Date.parse(evaluatedAt);
  return Number.isFinite(at) && at <= now + FUTURE_SKEW_MS && now - at <= AVAILABILITY_MAX_AGE_MS;
}

/**
 * `GET /api/v1/availability` from the controller's cached operations API. States and providers are
 * read as strings, and unknown values count as unknown, never as blocked. `health` describes the
 * controller's own collection, since `evaluatedAt` is always the time of the read.
 */
export const SwitchboardAvailability = Schema.Struct({
  version: Schema.Literal(1),
  service: Schema.Literal("switchboard"),
  evaluatedAt: Schema.String,
  health: Schema.optional(
    Schema.Struct({
      stale: Schema.optional(Schema.Boolean),
      error: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
  models: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      provider: Schema.String,
      state: Schema.String,
      reason: Schema.String,
      resetAt: Schema.optional(Schema.NullOr(Schema.Number)),
    }),
  ),
});
type SwitchboardAvailability = typeof SwitchboardAvailability.Type;

const DRIVERS: Readonly<Record<string, SwitchboardModelAvailability["driver"]>> = {
  claude: "claudeAgent",
  codex: "codex",
};
/** The Loom driver for a provider Switchboard names, ignoring inherited object keys. */
export const switchboardDriver = (provider: string) =>
  Object.hasOwn(DRIVERS, provider) ? DRIVERS[provider] : undefined;
const STATES: ReadonlySet<string> = new Set(["available", "restricted", "unavailable", "unknown"]);

const STALE: SwitchboardLimits = { limits: [], availability: "stale" };

/**
 * Turns Switchboard's per-model states into what the picker blocks. Only a confirmed `unavailable`
 * blocks its model; a provider is blocked only when every listed model is unavailable or
 * credit-only, which also covers models missing from its catalog. A stale or failed reading, an
 * empty catalog or no known state blocks nothing.
 */
export function switchboardLimits(
  snapshot: SwitchboardAvailability,
  now: number,
): SwitchboardLimits {
  if (
    !isCurrentEvaluation(snapshot.evaluatedAt, now) ||
    snapshot.health?.stale === true ||
    snapshot.health?.error === "controller-pass-failed"
  ) {
    return STALE;
  }
  const models: SwitchboardModelAvailability[] = snapshot.models.flatMap((model) => {
    const driver = switchboardDriver(model.provider);
    if (driver === undefined) return [];
    const resetAt = model.resetAt ?? null;
    return [
      {
        driver,
        id: model.id,
        state: STATES.has(model.state)
          ? (model.state as SwitchboardModelAvailability["state"])
          : "unknown",
        reason: model.reason,
        resetAt: resetAt !== null && Number.isFinite(resetAt) && resetAt > now ? resetAt : null,
      },
    ];
  });
  if (models.every((model) => model.state === "unknown")) return STALE;
  const limits: SwitchboardLimit[] = [];
  for (const driver of Object.values(DRIVERS)) {
    const listed = models.filter((model) => model.driver === driver);
    if (
      listed.length === 0 ||
      listed.some((model) => model.state === "available" || model.state === "unknown")
    ) {
      continue;
    }
    const resets = listed.flatMap((model) => (model.resetAt === null ? [] : [model.resetAt]));
    limits.push({
      driver,
      servedModels: listed.filter((model) => model.state === "restricted").map((model) => model.id),
      until: resets.length > 0 ? Math.min(...resets) : null,
    });
  }
  return { limits, models, availability: "available" };
}
